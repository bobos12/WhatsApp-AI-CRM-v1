import { prisma } from '../../lib/prisma';
import { normalizePhone } from '../../lib/phone';
import { logger } from '../../lib/logger';
import { bumpHealthCounter } from './account-health';

/**
 * ─── Suppression & opt-out ───────────────────────────────────────────────────
 *
 * The single most effective anti-ban mechanism in this entire module, and the
 * one the old implementation was missing outright: a way for a customer to make
 * the messages stop.
 *
 * WhatsApp does not ban an account for sending volume. It bans for *negative
 * recipient signal* — blocks and "report spam" taps. A customer who cannot opt
 * out has exactly one button available to them, and it is the one that gets the
 * business number restricted. Honouring "STOP" costs one recipient; ignoring it
 * costs the account.
 *
 * Two layers, deliberately:
 *
 *   • `Contact.marketingOptOut` — the human-facing flag agents see and can
 *     explain, tied to the CRM record.
 *   • `SuppressionEntry` — a phone-level list that outlives the contact record.
 *     Deleting and re-importing a contact is the classic way an opt-out gets
 *     silently reversed; this table is what stops that.
 *
 * Audience resolution consults both, always, with no override flag.
 */

/** Hard reasons never expire — the customer's decision is permanent. */
export const HARD_SUPPRESSION_REASONS = ['OPTED_OUT', 'COMPLAINT', 'BLOCKED_US', 'MANUAL'] as const;
/** Soft reasons decay, so a temporarily unreachable number is retried later. */
export const SOFT_SUPPRESSION_REASONS = ['NOT_ON_WHATSAPP', 'HARD_FAIL'] as const;

export type SuppressionReason =
  | (typeof HARD_SUPPRESSION_REASONS)[number]
  | (typeof SOFT_SUPPRESSION_REASONS)[number];

/** How long a soft suppression holds before the number becomes eligible again. */
const SOFT_TTL_MS: Record<string, number> = {
  NOT_ON_WHATSAPP: 30 * 24 * 60 * 60 * 1000, // a month; numbers do join WhatsApp
  HARD_FAIL: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Opt-out phrases, English and Arabic — this product ships bilingual and an
 * Arabic-speaking customer typing "توقف" deserves to be heard exactly as much as
 * one typing "STOP".
 *
 * Matching is deliberately conservative: the message must be *essentially only*
 * the keyword. "Stop by the shop at 5" is not an opt-out, and silently muting a
 * customer who was making plans would be its own kind of broken.
 */
const OPT_OUT_KEYWORDS = [
  // English
  'stop', 'unsubscribe', 'unsub', 'opt out', 'optout', 'opt-out', 'remove me',
  'no more messages', 'stop messaging', 'stop messaging me', 'leave me alone',
  'do not contact', "don't contact me", 'cancel subscription',
  // Arabic
  'توقف', 'إلغاء', 'الغاء', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'إلغاء الاشتراك',
  'لا تراسلني', 'كفى', 'اوقف', 'أوقف', 'حذفني', 'ازالة',
];

/** Phrases that mean "start again" — an opt-in reversal. */
const OPT_IN_KEYWORDS = ['start', 'subscribe', 'resume', 'unstop', 'اشتراك', 'ابدأ', 'ابدا'];

/** Strip punctuation/emoji so "STOP!" and "stop." both match. */
function canonicalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does this inbound message read as an opt-out?
 *
 * The message must be short and consist of the keyword (optionally padded with a
 * few filler words like "please"). Anything longer is a real conversation that
 * happens to contain the word.
 */
export function detectOptOut(text: string): boolean {
  const canonical = canonicalizeText(text);
  if (!canonical || canonical.length > 40) return false;

  const filler = new Set(['please', 'pls', 'plz', 'me', 'now', 'all', 'this', 'the', 'من', 'فضلك', 'لو', 'سمحت']);
  const remainder = (keyword: string) =>
    canonical
      .replace(keyword, ' ')
      .split(' ')
      .filter((word) => word && !filler.has(word));

  return OPT_OUT_KEYWORDS.some((keyword) => canonical.includes(keyword) && remainder(keyword).length === 0);
}

/** Does this inbound message read as an opt-in (re-subscribe)? */
export function detectOptIn(text: string): boolean {
  const canonical = canonicalizeText(text);
  if (!canonical || canonical.length > 24) return false;
  return OPT_IN_KEYWORDS.some((keyword) => canonical === keyword);
}

function expiryFor(reason: SuppressionReason): Date | null {
  const ttl = SOFT_TTL_MS[reason];
  return ttl ? new Date(Date.now() + ttl) : null;
}

/**
 * Add (or refresh) a suppression. Upsert semantics: a soft suppression never
 * downgrades a hard one, because "NOT_ON_WHATSAPP" arriving after "OPTED_OUT"
 * must not quietly give the number an expiry date.
 */
export async function suppress(
  phone: string,
  reason: SuppressionReason,
  options: { detail?: string; source?: string } = {},
): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) return;

  const existing = await prisma.suppressionEntry.findFirst({
    where: { phone: normalized },
    select: { id: true, reason: true },
  });

  if (existing && (HARD_SUPPRESSION_REASONS as readonly string[]).includes(existing.reason)) {
    return; // already permanently suppressed — nothing weaker may replace it
  }

  const data = {
    reason,
    detail: options.detail ?? null,
    source: options.source ?? null,
    expiresAt: expiryFor(reason),
  };

  if (existing) {
    await prisma.suppressionEntry.update({ where: { id: existing.id }, data });
  } else {
    await prisma.suppressionEntry.create({ data: { phone: normalized, ...data } });
  }
}

/** Remove a suppression (an agent vouching for a number, or a re-subscribe). */
export async function unsuppress(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  await prisma.suppressionEntry.deleteMany({ where: { phone: normalized } });
}

/**
 * Record a customer's opt-out across both layers and update today's health
 * rollup. Idempotent: opting out twice is a no-op, not a double count.
 */
export async function recordOptOut(
  phone: string,
  detail: string,
  source: 'inbound_keyword' | 'manual' | 'import' = 'inbound_keyword',
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const contact = await prisma.contact.findFirst({
    where: { phone: normalized },
    select: { id: true, marketingOptOut: true },
  });

  const alreadyOut = contact?.marketingOptOut === true;

  if (contact && !alreadyOut) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { marketingOptOut: true, optOutAt: new Date(), optOutReason: detail },
    });
  }

  await suppress(normalized, 'OPTED_OUT', { detail, source });

  if (!alreadyOut) {
    await bumpHealthCounter({ optOuts: 1 });
    logger.info('broadcast.opt_out_recorded', { phone: normalized, source });
  }
  return !alreadyOut;
}

/** Reverse an opt-out after an explicit re-subscribe. */
export async function recordOptIn(phone: string, detail: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) return;

  await prisma.contact.updateMany({
    where: { phone: normalized },
    data: {
      marketingOptOut: false,
      optOutAt: null,
      optOutReason: null,
      consentAt: new Date(),
      consentSource: 'inbound_message',
    },
  });
  await unsuppress(normalized);
  logger.info('broadcast.opt_in_recorded', { phone: normalized, detail });
}

export interface SuppressionHit {
  phone: string;
  reason: string;
  detail: string | null;
}

/**
 * Partition a list of E.164 numbers into deliverable and suppressed.
 *
 * Two indexed reads regardless of audience size — the alternative (checking each
 * phone as we reach it in the send loop) would mean a database round trip
 * between every message and, worse, would only discover an opt-out *after* the
 * campaign had already been sized and promised to the user.
 */
export async function partitionSuppressed(
  phones: string[],
): Promise<{ allowed: string[]; suppressed: Map<string, SuppressionHit> }> {
  const suppressed = new Map<string, SuppressionHit>();
  if (!phones.length) return { allowed: [], suppressed };

  const now = new Date();

  const [entries, optedOutContacts] = await Promise.all([
    prisma.suppressionEntry.findMany({
      where: {
        phone: { in: phones },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { phone: true, reason: true, detail: true },
    }),
    prisma.contact.findMany({
      where: { phone: { in: phones }, marketingOptOut: true },
      select: { phone: true, optOutReason: true },
    }),
  ]);

  for (const entry of entries) {
    suppressed.set(entry.phone, { phone: entry.phone, reason: entry.reason, detail: entry.detail });
  }
  for (const contact of optedOutContacts) {
    if (!suppressed.has(contact.phone)) {
      suppressed.set(contact.phone, {
        phone: contact.phone,
        reason: 'OPTED_OUT',
        detail: contact.optOutReason,
      });
    }
  }

  return {
    allowed: phones.filter((phone) => !suppressed.has(phone)),
    suppressed,
  };
}

/**
 * Handle an inbound message's consent implications.
 *
 * Called from the inbound pipeline for every customer message. Two jobs:
 *   1. STOP/START keyword handling.
 *   2. Implied consent — a customer who writes to us has opened a relationship,
 *      which is what makes them safe to message later.
 *
 * Returns whether the message was consumed as an opt-out, so the caller can skip
 * the AI bot (auto-replying to "STOP" with a chatbot greeting is precisely the
 * behaviour that earns a spam report).
 */
export async function applyInboundConsent(phone: string, text: string): Promise<{ optedOut: boolean }> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { optedOut: false };

  if (detectOptOut(text)) {
    await recordOptOut(normalized, `Replied: "${text.slice(0, 80)}"`, 'inbound_keyword');
    return { optedOut: true };
  }

  if (detectOptIn(text)) {
    const contact = await prisma.contact.findFirst({
      where: { phone: normalized },
      select: { marketingOptOut: true },
    });
    if (contact?.marketingOptOut) {
      await recordOptIn(normalized, `Replied: "${text.slice(0, 80)}"`);
      return { optedOut: false };
    }
  }

  // Implied consent, recorded once. `updateMany` with a null guard keeps the
  // original consent date rather than sliding it forward on every message.
  await prisma.contact
    .updateMany({
      where: { phone: normalized, consentAt: null },
      data: { consentAt: new Date(), consentSource: 'inbound_message' },
    })
    .catch(() => {});

  return { optedOut: false };
}

/**
 * The opt-out line appended to broadcast messages.
 *
 * Not decoration — it is the pressure-release valve that converts a would-be
 * "report spam" tap into a "STOP" reply we can honour. Kept short, and only
 * appended when the body has room inside WhatsApp's limit.
 */
export function optOutFooter(locale: 'en' | 'ar' = 'en'): string {
  return locale === 'ar' ? 'للإيقاف أرسل "توقف"' : 'Reply STOP to unsubscribe';
}

const MAX_BODY = 4096;

/** Append the opt-out line if it isn't already there and the body has room. */
export function withOptOutFooter(message: string, locale: 'en' | 'ar' = 'en'): string {
  const footer = optOutFooter(locale);
  const canonical = canonicalizeText(message);
  const alreadyPresent =
    canonical.includes(canonicalizeText(footer)) ||
    OPT_OUT_KEYWORDS.some((keyword) => canonical.includes(`reply ${keyword}`) || canonical.includes(`send ${keyword}`));
  if (alreadyPresent) return message;

  const candidate = `${message.trimEnd()}\n\n${footer}`;
  return candidate.length <= MAX_BODY ? candidate : message;
}
