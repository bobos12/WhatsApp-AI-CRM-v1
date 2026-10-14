import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { providerManager } from '../providers/manager';
import { getChannel } from '../providers/channel.service';
import { resolveAudienceDetailed, type AudienceFilter } from './audience';

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
  /** A one-tap remedy the UI can apply to the campaign form. */
  fix?: { action: 'choose_template' | 'connect_channel' | 'exclude_already_received'; label: string };
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
const TIER_CAPACITY: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
};

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
    label: `"${template.name}" is not approved for sending`,
    detail:
      byStatus[template.metaStatus ?? ''] ??
      'This template has not been submitted to WhatsApp for review yet. Submit it, then send once approved.',
    fix: { action: 'choose_template', label: 'Choose another template' },
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

  if (plan.length === 0) {
    findings.push({
      key: 'empty_audience',
      kind: 'blocker',
      label: 'No one would receive this campaign',
      detail: 'Every selected contact was filtered out or has an unusable phone number.',
    });
  }

  // 5. Messaging tier headroom — informational, because Meta enforces it.
  const capacity = channel.messagingLimit ? TIER_CAPACITY[channel.messagingLimit] : undefined;
  if (capacity && plan.length > capacity) {
    findings.push({
      key: 'over_messaging_tier',
      kind: 'warning',
      label: `Your number can start ${capacity.toLocaleString()} conversations per day`,
      detail:
        `This campaign targets ${plan.length.toLocaleString()} people, so WhatsApp will refuse the excess until your ` +
        'limit resets or Meta raises your tier. Delivery continues automatically the next day.',
    });
  }

  if (channel.qualityRating === 'RED' || channel.qualityRating === 'YELLOW') {
    findings.push({
      key: 'quality_rating_low',
      kind: 'warning',
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
