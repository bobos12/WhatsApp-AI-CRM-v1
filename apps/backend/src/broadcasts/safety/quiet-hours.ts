import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { isValidTimeZone } from '../../lib/timezone';

/**
 * ─── Quiet hours ─────────────────────────────────────────────────────────────
 *
 * A marketing message that wakes someone at 3 a.m. does not get read; it gets
 * the sender blocked. The old scheduler had no concept of the recipient's local
 * time at all — a campaign whose server had been down simply fired whenever the
 * process came back up, at whatever hour that happened to be, and a smart-sending
 * run that started at 6 p.m. kept batching straight through the night.
 *
 * Recipient-local, not business-local: a Dubai shop with customers in Cairo and
 * London is three different nights, and the one that matters is the recipient's.
 * The zone is inferred from the phone's country code, falling back to the
 * campaign's own zone when the number is ambiguous.
 */

/**
 * Representative IANA zone per calling region.
 *
 * A country can span several zones; we pick the one holding most of the
 * population. The consequence of being an hour off is that a message lands at
 * 8 a.m. instead of 9 a.m. — acceptable. The consequence of having no mapping at
 * all is a 3 a.m. delivery, which is not.
 */
const REGION_ZONES: Record<string, string> = {
  AE: 'Asia/Dubai',      SA: 'Asia/Riyadh',     EG: 'Africa/Cairo',    KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar',      BH: 'Asia/Bahrain',    OM: 'Asia/Muscat',     JO: 'Asia/Amman',
  LB: 'Asia/Beirut',     IQ: 'Asia/Baghdad',    SY: 'Asia/Damascus',   YE: 'Asia/Aden',
  MA: 'Africa/Casablanca', DZ: 'Africa/Algiers', TN: 'Africa/Tunis',   LY: 'Africa/Tripoli',
  SD: 'Africa/Khartoum', PS: 'Asia/Hebron',     TR: 'Europe/Istanbul',
  // +44 is shared: libphonenumber attributes many valid UK-format numbers to the
  // Crown dependencies rather than GB. They keep London time, so all four map to
  // the same zone — without this a British recipient silently falls back to the
  // sender's clock, which is exactly the case quiet hours exist to get right.
  GB: 'Europe/London',   GG: 'Europe/London',   JE: 'Europe/London',   IM: 'Europe/London',
  IE: 'Europe/Dublin',   FR: 'Europe/Paris',    DE: 'Europe/Berlin',
  ES: 'Europe/Madrid',   IT: 'Europe/Rome',     NL: 'Europe/Amsterdam', BE: 'Europe/Brussels',
  PT: 'Europe/Lisbon',   CH: 'Europe/Zurich',   AT: 'Europe/Vienna',   SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',     DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw',
  GR: 'Europe/Athens',   RO: 'Europe/Bucharest', RU: 'Europe/Moscow',  UA: 'Europe/Kyiv',
  US: 'America/Chicago', CA: 'America/Toronto',  MX: 'America/Mexico_City',
  BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago',
  CO: 'America/Bogota',  PE: 'America/Lima',
  IN: 'Asia/Kolkata',    PK: 'Asia/Karachi',    BD: 'Asia/Dhaka',      LK: 'Asia/Colombo',
  ID: 'Asia/Jakarta',    MY: 'Asia/Kuala_Lumpur', SG: 'Asia/Singapore', TH: 'Asia/Bangkok',
  PH: 'Asia/Manila',     VN: 'Asia/Ho_Chi_Minh', CN: 'Asia/Shanghai',  HK: 'Asia/Hong_Kong',
  JP: 'Asia/Tokyo',      KR: 'Asia/Seoul',      TW: 'Asia/Taipei',
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', GH: 'Africa/Accra',
  ET: 'Africa/Addis_Ababa', TZ: 'Africa/Dar_es_Salaam', UG: 'Africa/Kampala',
};

/** IANA zone for a phone number, or null when the region is unknown. */
export function zoneForPhone(phone: string): string | null {
  try {
    const parsed = parsePhoneNumberFromString(phone);
    const region = parsed?.country;
    return region ? (REGION_ZONES[region] ?? null) : null;
  } catch {
    return null;
  }
}

/** The hour (0–23) it currently is at `instant` in `timeZone`. */
export function hourInZone(instant: Date, timeZone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(instant);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : instant.getUTCHours();
  } catch {
    return instant.getUTCHours();
  }
}

export interface QuietHoursWindow {
  enabled: boolean;
  /** Local hour the quiet window opens, e.g. 21. */
  start: number;
  /** Local hour it closes, e.g. 9. */
  end: number;
}

/** Is `hour` inside the window? Handles the normal midnight-wrapping case. */
export function isQuietHour(hour: number, window: QuietHoursWindow): boolean {
  if (!window.enabled) return false;
  const { start, end } = window;
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export interface QuietCheck {
  quiet: boolean;
  zone: string;
  localHour: number;
  /** When delivery may resume, if currently quiet. */
  resumesAt: Date | null;
}

/**
 * Would sending to this number right now land in their night?
 *
 * `fallbackZone` is the campaign's zone — used when the number's region can't be
 * determined, which is the honest best guess available.
 */
export function checkQuietHours(
  phone: string,
  window: QuietHoursWindow,
  fallbackZone: string,
  at: Date = new Date(),
): QuietCheck {
  const zone = zoneForPhone(phone) ?? (isValidTimeZone(fallbackZone) ? fallbackZone : 'UTC');
  const localHour = hourInZone(at, zone);

  if (!isQuietHour(localHour, window)) {
    return { quiet: false, zone, localHour, resumesAt: null };
  }

  // Hours until the window closes, then rounded up to that local hour boundary.
  const hoursUntilOpen = (window.end - localHour + 24) % 24 || 24;
  const resumesAt = new Date(at.getTime() + hoursUntilOpen * 60 * 60 * 1000);
  resumesAt.setUTCMinutes(0, 0, 0);

  return { quiet: true, zone, localHour, resumesAt };
}

/**
 * The earliest instant at or after `from` at which *any* delivery is allowed.
 *
 * Used by the scheduler to park a whole campaign rather than testing each
 * recipient. Uses the campaign zone: parking per-recipient would fragment a run
 * into dozens of wake-ups for no real gain, since the audience of one campaign
 * is usually in one or two regions.
 */
export function nextAllowedTime(window: QuietHoursWindow, zone: string, from: Date = new Date()): Date {
  if (!window.enabled) return from;
  const localHour = hourInZone(from, zone);
  if (!isQuietHour(localHour, window)) return from;

  const hoursUntilOpen = (window.end - localHour + 24) % 24 || 24;
  const resume = new Date(from.getTime() + hoursUntilOpen * 60 * 60 * 1000);
  resume.setUTCMinutes(0, 0, 0);
  return resume;
}

/** Deliverable hours per day, for the campaign-duration simulation. */
export function activeHoursPerDay(window: QuietHoursWindow): number {
  if (!window.enabled) return 24;
  const { start, end } = window;
  if (start === end) return 24;
  const quiet = start > end ? 24 - start + end : end - start;
  return Math.max(1, 24 - quiet);
}

/**
 * Regions represented in an audience, so the pre-flight report can say
 * "recipients span 3 time zones" instead of pretending everyone is local.
 */
export function zoneBreakdown(phones: string[]): Array<{ zone: string; count: number }> {
  const counts = new Map<string, number>();
  for (const phone of phones) {
    const zone = zoneForPhone(phone) ?? 'unknown';
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count);
}
