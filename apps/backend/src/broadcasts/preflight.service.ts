import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getTenantId } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { getChannel } from '../providers/channel.service';
import { resolveAudienceDetailed, type AudienceFilter } from './audience';
import { buildPersonalizationVars } from './personalization';
import { CONTACT_FIELDS, defaultFallback, readBlank } from '@crm/messaging-schema';

/**
 * ─── Pre-flight ──────────────────────────────────────────────────────────────
 *
 * One entry point that answers: who would actually receive this campaign, and is
 * there anything stopping it from being sent.
 *
 * This replaced a much larger ban-prevention engine that existed because the CRM
 * used to send over an unofficial WhatsApp Web library, where volume alone could
 * get a number banned without appeal. On the official Cloud API that class of
 * risk is Meta's to manage: they enforce a messaging limit tier, they publish a
 * quality rating, and they simply refuse traffic that exceeds either. So the
 * checks here are the ones Meta actually enforces, rather than heuristics
 * guessing at what might upset an unofficial protocol.
 *
 * Run twice in a campaign's life — live in the composer while the user edits,
 * and again at claim time, where its blockers are enforced. Same code both
 * times, so what the user was shown is what the sender does.
 */

export interface PreflightInput {
  message: string;
  recipients?: string[];
  tag?: string;
  filter?: AudienceFilter | null;
  teamId?: string;
  mediaUrl?: string | null;
  interactiveContent?: object | null;
  /** The approved template this campaign sends. Required — see `checkTemplate`. */
  templateId?: string | null;
  /** How the template's blanks are filled (see readBlank). */
  templateVariables?: Record<string, string> | null;
  /** Exclude this campaign from its own duplicate check (it is the one being edited). */
  excludeBroadcastId?: string;
  /** Drop anyone who already received a given broadcast. */
  excludeReceivedFrom?: string;
}

export interface PreflightFinding {
  key: string;
  /** `blocker` prevents sending; the rest inform. */
  kind: 'blocker' | 'warning' | 'tip';
  label: string;
  detail: string;
  /**
   * Values for the translated wording. The client renders
   * `safety.findings.<key before ':'>` with these, and falls back to
   * label/detail (English) when it has no translation.
   */
  params?: Record<string, string | number>;
  /** A one-tap remedy the UI can apply to the campaign form. */
  fix?: {
    action: 'choose_template' | 'connect_channel' | 'exclude_already_received';
    label: string;
    /** For `exclude_already_received`: the earlier campaign to exclude. */
    broadcastId?: string;
  };
}

export interface PlannedRecipient {
  phone: string;
  contactId: string | null;
  name: string | null;
  /** Set when the recipient will NOT be sent to, so the UI can explain the shortfall. */
  skipReason?: string | null;
}

export interface PreflightReport {
  generatedAt: string;
  /** True when nothing blocks the send. */
  canSend: boolean;
  findings: PreflightFinding[];
  audience: {
    requested: number;
    deliverable: number;
    invalid: number;
    duplicates: number;
    alreadyReceived: number;
  };
  channel: {
    connected: boolean;
    displayPhoneNumber: string | null;
    qualityRating: string;
    /** Meta's cap on unique customers you may start conversations with per 24h. */
    messagingLimit: string | null;
  };
  template: { id: string; name: string; status: string | null } | null;
}

export interface PreflightResult {
  report: PreflightReport;
  /** Deliverable recipients, in send order. Consumed by the audience writer. */
  plan: PlannedRecipient[];
  /** Everyone excluded, with the reason. */
  excluded: PlannedRecipient[];
  contentHash: string;
}

/**
 * Stable fingerprint of what a campaign sends. Retained because the column
 * exists and it makes "you already sent this" answerable, but it no longer
 * drives any automatic refusal.
 */
export function contentFingerprint(input: {
  message?: string | null;
  mediaUrl?: string | null;
  templateId?: string | null;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${input.message ?? ''}|${input.mediaUrl ?? ''}|${input.templateId ?? ''}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Meta's messaging limit tiers, as a number of unique customers per rolling 24h.
 * Used only to warn when an audience obviously exceeds the tier — Meta enforces
 * the real limit, we just say so before the run rather than after.
 */
export const TIER_CAPACITY: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
};

/**
 * Meta's tier name → people per 24h. Meta renames tiers as it changes the
 * ladder (TIER_2K appeared alongside TIER_1K), so read the number from the
 * name instead of trusting a fixed list: TIER_2K → 2000, TIER_250 → 250.
 */
export function tierCapacity(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t in TIER_CAPACITY) return TIER_CAPACITY[t] === Number.MAX_SAFE_INTEGER ? null : TIER_CAPACITY[t];
  const m = t.match(/^TIER_(\d+(?:\.\d+)?)(K|M)?$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1));
}

export interface DailyUsage {
  /** Meta's limit for this number, or null when unknown / unlimited. */
  limit: number | null;
  /** Unique people sent a template (campaign or one-off) in the last 24h. */
  used: number;
  /** limit - used, floored at 0; null when the limit is unknown. */
  remaining: number | null;
  /** Recipients still waiting in campaigns due to send within the next 24h. */
  scheduledSoon: number;
}

/**
 * How much of Meta's rolling-24h messaging limit is already spent. Meta counts
 * unique customers who received a business-initiated (template) message, so we
 * count distinct phone numbers across campaign sends and one-off template sends.
 * One aggregate query each — the composer calls this on every edit, and a list of
 * phones would cost database egress for nothing.
 */
export async function dailyUsage(messagingLimit: string | null): Promise<DailyUsage> {
  try {
    return await countDailyUsage(messagingLimit);
  } catch (err) {
    // Advisory only — a failed count must never block creating a campaign.
    logger.warn('broadcast.daily_usage_failed', { error: err instanceof Error ? err.message : String(err) });
    const limit = tierCapacity(messagingLimit);
    return { limit, used: 0, remaining: limit, scheduledSoon: 0 };
  }
}

async function countDailyUsage(messagingLimit: string | null): Promise<DailyUsage> {
  const now = Date.now();
  const since = new Date(now - 24 * 60 * 60 * 1000);
  const soon = new Date(now + 24 * 60 * 60 * 1000);
  const tenantId = getTenantId();
  const tenantFilter = (alias: string) =>
    tenantId ? Prisma.sql`AND ${Prisma.raw(alias)}."tenantId" = ${tenantId}` : Prisma.empty;

  const [usedRows, scheduledSoon] = await Promise.all([
    prisma.$queryRaw<Array<{ used: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT regexp_replace(phone, '\D', '', 'g')) AS used FROM (
        SELECT r.phone FROM "BroadcastRecipient" r
         WHERE r."sentAt" >= ${since} ${tenantFilter('r')}
        UNION ALL
        SELECT m.phone FROM "Message" m
         WHERE m."direction" = 'OUTBOUND' AND m."kind" = 'template'
           AND m."timestamp" >= ${since} ${tenantFilter('m')}
      ) sent
    `),
    prisma.broadcastRecipient.count({
      where: {
        status: 'pending',
        broadcast: {
          OR: [
            { status: 'SCHEDULED', scheduledAt: { lte: soon } },
            { status: 'SENDING' },
          ],
        },
      },
    }),
  ]);

  const used = Number(usedRows[0]?.used ?? 0);
  const limit = tierCapacity(messagingLimit);
  return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used), scheduledSoon };
}

/**
 * The template gate.
 *
 * A broadcast audience is, by definition, almost entirely outside the 24-hour
 * customer service window, so free-form content is refused per recipient with
 * error 131047 and only an approved template delivers. This is a blocker rather
 * than a warning because it is not a matter of degree: without a template the
 * campaign does not deliver poorly, it delivers to nobody.
 */
async function checkTemplate(templateId?: string | null): Promise<PreflightFinding | null> {
  if (!templateId) {
    return {
      key: 'template_required',
      kind: 'blocker',
      label: 'This campaign needs an approved template',
      detail:
        'WhatsApp only delivers to people who have not messaged you in the last 24 hours if the message is a template it has approved. Choose one, or create and submit a template first.',
      fix: { action: 'choose_template', label: 'Choose a template' },
    };
  }

  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, metaStatus: true, metaRejectedReason: true },
  });

  if (!template) {
    return {
      key: 'template_missing',
      kind: 'blocker',
      label: 'The selected template no longer exists',
      detail: 'Choose another template for this campaign.',
      fix: { action: 'choose_template', label: 'Choose a template' },
    };
  }

  if (template.metaStatus === 'APPROVED') return null;

  const byStatus: Record<string, string> = {
    PENDING: 'WhatsApp is still reviewing this template. Reviews usually finish in minutes, occasionally up to 24 hours.',
    REJECTED: template.metaRejectedReason
      ? `WhatsApp rejected this template: ${template.metaRejectedReason}`
      : 'WhatsApp rejected this template. Edit it and submit it again.',
    PAUSED: 'WhatsApp paused this template because of poor recipient feedback. Use a different one.',
    DISABLED: 'WhatsApp disabled this template permanently. Use a different one.',
  };

  return {
    key: 'template_not_approved',
    kind: 'blocker',
    params: { name: template.name, status: template.metaStatus ?? 'NONE', reason: template.metaRejectedReason ?? '' },
    label: `"${template.name}" is not approved for sending`,
    detail:
      byStatus[template.metaStatus ?? ''] ??
      'This template has not been submitted to WhatsApp for review yet. Submit it, then send once approved.',
    fix: { action: 'choose_template', label: 'Choose another template' },
  };
}

/**
 * Every blank in the template must end up with a value — Meta refuses the whole
 * message otherwise. An unset blank blocks; a contact field that is empty for
 * some recipients only informs, because those people get the backup text.
 */
async function checkBlanks(
  templateId: string,
  mapping: Record<string, string> | null,
  plan: PlannedRecipient[],
): Promise<PreflightFinding[]> {
  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    select: { variables: true, language: true },
  });
  const slots = Array.isArray(template?.variables) ? (template!.variables as string[]) : [];
  if (!slots.length) return [];

  const customKeys = (await prisma.customFieldDefinition.findMany({ select: { key: true } })).map((f) => f.key);
  const known = [...CONTACT_FIELDS, ...customKeys];
  const blanks = slots.map((slot) => ({ slot, source: readBlank(mapping, slot, known) }));

  const unset = blanks.filter((b) => b.source.kind === 'unset' || (b.source.kind === 'text' && !b.source.text.trim()));
  if (unset.length) {
    return [{
      key: 'template_blanks_unset',
      kind: 'blocker',
      params: { count: unset.length, slot: unset[0].slot },
      label: unset.length === 1
        ? `Blank ${'{{'}${unset[0].slot}${'}}'} in the template needs a value`
        : `${unset.length} blanks in the template need a value`,
      detail: 'For each blank, choose what to put there: a contact detail such as the name, or the same text for everyone.',
      fix: { action: 'choose_template', label: 'Fill in the blanks' },
    }];
  }

  // Who would see a backup value instead of their own detail.
  const fieldBlanks = blanks.filter((b) => b.source.kind === 'field') as Array<{
    slot: string;
    source: { kind: 'field'; field: string; fallback: string };
  }>;
  if (!fieldBlanks.length || !plan.length) return [];

  const contactIds = plan.map((r) => r.contactId).filter((id): id is string => Boolean(id));
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, phone: true, name: true, email: true, company: true, customFields: true },
      })
    : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));

  const findings: PreflightFinding[] = [];
  for (const { slot, source } of fieldBlanks) {
    let missing = 0;
    for (const recipient of plan) {
      const contact = recipient.contactId ? byId.get(recipient.contactId) : undefined;
      const vars = buildPersonalizationVars(contact, recipient.phone);
      if (!vars[source.field]?.trim()) missing += 1;
    }
    if (!missing) continue;
    const shown = source.fallback.trim() || defaultFallback(source.field, template?.language);
    findings.push({
      key: `template_blank_missing:${slot}`,
      kind: 'tip',
      params: { count: missing, field: source.field, slot, shown },
      label: `${missing.toLocaleString()} ${missing === 1 ? 'person has' : 'people have'} no ${source.field.replace(/_/g, ' ')} saved`,
      detail: `They will see “${shown}” in blank ${'{{'}${slot}${'}}'} instead. You can change this backup text next to the blank.`,
    });
  }
  return findings;
}

/**
 * The same template to the same people within a day is the pattern Meta's
 * marketing limits are built to stop (131049): those messages are usually not
 * delivered, and recipients who do get it twice are the ones who block.
 */
async function checkRecentRepeat(
  templateId: string,
  plan: PlannedRecipient[],
  excludeBroadcastId?: string,
): Promise<PreflightFinding | null> {
  if (!plan.length) return null;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overlaps = await prisma.broadcastRecipient.groupBy({
    by: ['broadcastId'],
    where: {
      status: 'sent',
      sentAt: { gte: since },
      phone: { in: plan.map((r) => r.phone) },
      broadcast: { templateId, ...(excludeBroadcastId ? { id: { not: excludeBroadcastId } } : {}) },
    },
    _count: { _all: true },
  });
  if (!overlaps.length) return null;
  const top = overlaps.reduce((a, b) => (b._count._all > a._count._all ? b : a));
  const total = overlaps.reduce((sum, row) => sum + row._count._all, 0);
  return {
    key: 'recent_repeat',
    kind: 'warning',
    params: { count: total },
    label: `${total.toLocaleString()} of these people got this same template in the last 24 hours`,
    detail:
      'WhatsApp usually holds back a repeat marketing message within a day, and people who get the same offer twice are the ones who block. Leave them out to keep your number in good standing.',
    fix: { action: 'exclude_already_received', label: 'Leave them out', broadcastId: top.broadcastId },
  };
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const findings: PreflightFinding[] = [];

  // 1. Resolve and canonicalize the audience.
  const audience = await resolveAudienceDetailed({
    recipients: input.recipients,
    tag: input.tag,
    filter: input.filter,
    teamId: input.teamId,
  });

  // 2. Attach contact identity for the plan rows.
  const contacts = audience.phones.length
    ? await prisma.contact.findMany({
        where: { phone: { in: audience.phones } },
        select: { id: true, phone: true, name: true },
      })
    : [];
  const byPhone = new Map(contacts.map((c) => [c.phone, c]));

  let plan: PlannedRecipient[] = audience.phones.map((phone) => ({
    phone,
    contactId: byPhone.get(phone)?.id ?? null,
    name: byPhone.get(phone)?.name ?? null,
  }));

  // 3. Optional exclusion: anyone who already received a prior campaign.
  let alreadyReceived = 0;
  const excluded: PlannedRecipient[] = [];
  if (input.excludeReceivedFrom) {
    const prior = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: input.excludeReceivedFrom, status: 'sent', phone: { in: audience.phones } },
      select: { phone: true },
    });
    const received = new Set(prior.map((r) => r.phone));
    alreadyReceived = received.size;
    plan = plan.filter((r) => {
      if (!received.has(r.phone)) return true;
      excluded.push({ ...r, skipReason: 'ALREADY_RECEIVED' });
      return false;
    });
  }

  for (const phone of audience.invalid) {
    excluded.push({ phone, contactId: null, name: null, skipReason: 'INVALID_PHONE' });
  }

  // 4. Channel + template gates.
  const channel = await getChannel();
  const status = await providerManager.getStatus();

  if (!channel.cloud) {
    findings.push({
      key: 'channel_not_connected',
      kind: 'blocker',
      label: 'No WhatsApp number is connected',
      detail: 'Connect your WhatsApp Business number in Settings before sending a campaign.',
      fix: { action: 'connect_channel', label: 'Connect a number' },
    });
  } else if (status.status !== 'connected') {
    findings.push({
      key: 'channel_unavailable',
      kind: 'blocker',
      label: 'This WhatsApp number cannot send right now',
      detail: status.error?.message ?? 'Meta is not accepting messages from this number at the moment.',
    });
  }

  const templateFinding = await checkTemplate(input.templateId);
  if (templateFinding) findings.push(templateFinding);
  else if (input.templateId) findings.push(...(await checkBlanks(input.templateId, input.templateVariables ?? null, plan)));

  const repeat = input.templateId ? await checkRecentRepeat(input.templateId, plan, input.excludeBroadcastId) : null;
  if (repeat) findings.push(repeat);

  if (plan.length === 0) {
    findings.push({
      key: 'empty_audience',
      kind: 'blocker',
      label: 'No one would receive this campaign',
      detail: 'Every selected contact was filtered out or has an unusable phone number.',
    });
  }

  // 5. Messaging tier headroom — what is LEFT today, not the bare tier: a campaign
  // of 700 is fine on a 2,000 limit, unless 1,500 people were already messaged.
  const usage = await dailyUsage(channel.messagingLimit);
  const capacity = usage.limit;
  if (capacity !== null && usage.remaining !== null && plan.length > usage.remaining) {
    findings.push({
      key: 'over_messaging_tier',
      kind: 'warning',
      params: { capacity, count: plan.length, used: usage.used, remaining: usage.remaining },
      label: `Only ${usage.remaining.toLocaleString()} of today's ${capacity.toLocaleString()} new conversations are left`,
      detail:
        `${usage.used.toLocaleString()} people were already messaged in the last 24 hours and this campaign targets ` +
        `${plan.length.toLocaleString()}, so WhatsApp will refuse the excess until the limit frees up. ` +
        'Send to fewer people now, or schedule the rest for tomorrow.',
    });
  }

  if (channel.qualityRating === 'RED' || channel.qualityRating === 'YELLOW') {
    findings.push({
      key: 'quality_rating_low',
      kind: 'warning',
      params: { rating: channel.qualityRating },
      label: `WhatsApp rates this number's quality as ${channel.qualityRating}`,
      detail:
        'Recipients have been blocking or reporting your messages. Sending more marketing now risks Meta lowering your messaging limit or restricting the number.',
    });
  }

  const template = input.templateId
    ? await prisma.messageTemplate.findUnique({
        where: { id: input.templateId },
        select: { id: true, name: true, metaStatus: true },
      })
    : null;

  const report: PreflightReport = {
    generatedAt: new Date().toISOString(),
    canSend: findings.every((f) => f.kind !== 'blocker'),
    findings,
    audience: {
      requested: audience.requested,
      deliverable: plan.length,
      invalid: audience.invalid.length,
      duplicates: audience.duplicates,
      alreadyReceived,
    },
    channel: {
      connected: Boolean(channel.cloud),
      displayPhoneNumber: channel.cloud?.displayPhoneNumber ?? null,
      qualityRating: channel.qualityRating,
      messagingLimit: channel.messagingLimit,
    },
    template: template
      ? { id: template.id, name: template.name, status: template.metaStatus }
      : null,
  };

  return {
    report,
    plan,
    excluded,
    contentHash: contentFingerprint({
      message: input.message,
      mediaUrl: input.mediaUrl,
      templateId: input.templateId,
    }),
  };
}

// ── Claim-time gate ──────────────────────────────────────────────────────────

export type AccountGateCode = 'NOT_CONNECTED' | 'CHANNEL_RESTRICTED';

export interface AccountGate {
  ok: boolean;
  reason: string | null;
  code: AccountGateCode | null;
}

/**
 * Re-check the channel immediately before a claimed run starts.
 *
 * A campaign scheduled on Monday for Friday was assessed against Monday's state.
 * If the token expired or Meta restricted the number on Wednesday, Friday's send
 * must not proceed on Monday's verdict — this is the cheap re-read that catches
 * that without re-resolving a 50,000-row audience.
 */
export async function verifyAccountGate(): Promise<AccountGate> {
  const status = await providerManager.getStatus();

  if (status.status === 'connected') return { ok: true, reason: null, code: null };

  const channel = await getChannel();
  if (!channel.cloud) {
    return {
      ok: false,
      code: 'NOT_CONNECTED',
      reason: 'No WhatsApp number is connected, so there is nothing to send from. Connect a number first.',
    };
  }

  return {
    ok: false,
    code: 'CHANNEL_RESTRICTED',
    reason: status.error?.message ?? 'WhatsApp is not accepting messages from this number at the moment.',
  };
}

/**
 * The content half of pre-flight, for the moment of sending.
 *
 * A campaign can be saved incomplete, duplicated, or have its template change
 * status after it was saved. Starting it anyway would only pause it a second
 * later; refusing here keeps the user on the screen where they can fix it.
 */
export async function verifyCampaignContent(
  templateId: string | null,
  templateVariables: Record<string, string> | null,
): Promise<PreflightFinding | null> {
  const templateFinding = await checkTemplate(templateId);
  if (templateFinding) return templateFinding;
  const blanks = await checkBlanks(templateId!, templateVariables, []);
  return blanks.find((finding) => finding.kind === 'blocker') ?? null;
}
