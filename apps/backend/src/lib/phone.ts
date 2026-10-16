import { parsePhoneNumberFromString } from 'libphonenumber-js';

// Saudi Arabia unless configured: most customers save numbers locally as
// 05xxxxxxxx, and reading those as another country would message a stranger.
const DEFAULT_REGION = (process.env.WA_DEFAULT_REGION || process.env.DEFAULT_COUNTRY_CODE || 'SA').toUpperCase();

/**
 * Countries tried, in order, for a number saved without its country code. The
 * default region always goes first. A local number valid in several of these
 * (UAE and Saudi mobiles both start 05…) is read as the first — which is why
 * pre-flight lists every number that was read this way before anything is sent.
 */
const LOCAL_FALLBACKS = [
  'SA', 'EG', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'LB', 'IQ', 'SY', 'YE', 'PS', 'SD',
  'MA', 'DZ', 'TN', 'LY', 'TR', 'PK', 'IN', 'BD', 'PH', 'ID', 'GB', 'US',
];

export interface PhoneReading {
  /** +<country><number> */
  e164: string;
  /** ISO country, e.g. SA, EG, AE. */
  country: string | null;
  /**
   * True when the input carried no country code (+ or 00) and the country was
   * inferred. Such numbers are reported in pre-flight so a wrong guess is seen
   * before anyone is messaged.
   */
  assumed: boolean;
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Arabic-Indic and Persian digits → 0-9; full-width plus → +. */
function westernize(text: string): string {
  return text
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/＋/g, '+');
}

function tryParse(text: string, region?: string) {
  const parsed = parsePhoneNumberFromString(text, region as any);
  return parsed?.isValid() ? parsed : null;
}

/**
 * Read any phone number the way a person would.
 *
 *  • With a country code (+966…, 00971…): exactly as written, any country.
 *    A number written with + is never re-interpreted as another country.
 *  • Country code without + (966…, 201…): read as international.
 *  • Local (05…, 01…, 5…): the default country first, then common ones.
 */
export function readPhone(input: string, defaultCountry = DEFAULT_REGION): PhoneReading | null {
  const raw = westernize(String(input || '').trim());
  if (!raw || raw.includes('@g.us') || raw.includes('@broadcast')) return null;

  const hasPlus = raw.replace(/[\s()\-.]/g, '').startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15 + 2) return null;

  // Written with an international prefix: no guessing.
  if (hasPlus || digits.startsWith('00')) {
    const international = tryParse('+' + (hasPlus ? digits : digits.slice(2)));
    return international ? { e164: international.number, country: international.country ?? null, assumed: false } : null;
  }

  const regions = [defaultCountry, ...LOCAL_FALLBACKS.filter((r) => r !== defaultCountry)];
  const asLocal = () => {
    for (const region of regions) {
      const local = tryParse(digits, region);
      if (local) return local;
    }
    return null;
  };

  // Leading 0 is a local trunk prefix everywhere in this region.
  if (digits.startsWith('0')) {
    const local = asLocal();
    return local ? { e164: local.number, country: local.country ?? null, assumed: true } : null;
  }

  // No prefix at all: either a country code without + (966501234567) or a
  // local number without its 0 (501234567). Long numbers are international.
  const international = tryParse('+' + digits);
  const local = tryParse(digits, defaultCountry);
  const pick =
    international && local ? (digits.length >= 11 ? international : local) : international ?? local ?? asLocal();
  return pick ? { e164: pick.number, country: pick.country ?? null, assumed: true } : null;
}

export function normalizePhone(input: string, defaultCountry = DEFAULT_REGION): string | null {
  return readPhone(input, defaultCountry)?.e164 ?? null;
}

export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(String(phone || '').trim());
}

/**
 * ISO-3166 region a fully-qualified number belongs to (e.g. "+201012345678" → "EG",
 * "+971501234567" → "AE"). Returns null for local numbers with no country code —
 * those are genuinely ambiguous and can't be attributed to a region on their own.
 * Used to derive an import's default region from the connected business number.
 */
export function regionOfPhone(input: string): string | null {
  const normalized = normalizePhone(input);
  if (!normalized) return null;
  const parsed = parsePhoneNumberFromString(normalized);
  return parsed?.country ?? null;
}

export function phoneFingerprint(phone: string): string {
  const normalized = normalizePhone(phone);
  return normalized ? normalized.replace(/[^\d]/g, '') : '';
}

export function parseWhatsAppJid(phoneOrJid: string): string | null {
  const trimmed = String(phoneOrJid || '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('@g.us') || trimmed.includes('@broadcast')) return null;
  if (trimmed.includes('@s.whatsapp.net')) {
    const [userPart] = trimmed.split('@');
    const numberPart = userPart.split(':')[0];
    // WhatsApp JIDs encode the full international number without a + prefix.
    // Prepend + so libphonenumber-js recognises the country code correctly.
    return normalizePhone(`+${numberPart}`) || normalizePhone(numberPart);
  }
  return normalizePhone(trimmed);
}

export function canonicalPhone(phone: string): string {
  return normalizePhone(phone) || '';
}

export function normalizeRecipient(phoneOrJid: string): string {
  const normalized = normalizePhone(phoneOrJid);
  if (!normalized) return '';
  return `${normalized.slice(1)}@s.whatsapp.net`;
}

export function toWhatsAppJid(phone: string): string {
  return normalizeRecipient(phone);
}

/** Returns true if the JID identifies a WhatsApp group. Used to drop group messages at the inbound gate. */
export function isGroupJid(jid: string): boolean {
  return String(jid || '').includes('@g.us');
}
