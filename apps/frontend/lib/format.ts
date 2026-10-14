// Shared formatting, so a number or a time reads the same on every screen.

export function localeFor(language: string | undefined): string {
  // Western digits in Arabic UI: phone numbers, prices and counts are copied
  // between WhatsApp, invoices and this app, and mixed digit systems cause errors.
  return language?.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US';
}

export function formatNumber(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

/** 1,284 → "1,284"; 128,400 → "128K"; 1,240,000 → "1.2M". */
export function formatCompact(n: number, locale: string): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString(locale);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Deal values. One place to change the currency for the whole product. */
export function formatMoney(n: number, locale: string, compact = false): string {
  return `$${compact ? formatCompact(n, locale) : n.toLocaleString(locale)}`;
}

/**
 * WhatsApp-style timestamp for lists: time today, "Yesterday", weekday within
 * the week, then a short date.
 */
export function formatListTime(input: string | number | Date, locale: string, yesterday: string): string {
  const d = new Date(input);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (t >= startOfToday - 86_400_000) return yesterday;
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString(locale, { weekday: 'short' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** Compact elapsed time: "now", "4m", "2h", "3d". */
export function formatAgo(input: string | number | Date, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(input).getTime()) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Deal stages in funnel order, with one colour ramp shared by every pipeline view. */
export const DEAL_STAGES = ['NEW', 'INTERESTED', 'NEGOTIATION', 'CLOSED'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

// A single-hue ramp: the further along, the stronger the green. A funnel is one
// quantity moving through steps, so it gets one hue, not four unrelated ones.
export const STAGE_TONE: Record<string, { bar: string; dot: string; text: string }> = {
  NEW:         { bar: 'bg-brand-200 dark:bg-brand-900', dot: 'bg-brand-200 dark:bg-brand-800', text: 'text-ink-2' },
  INTERESTED:  { bar: 'bg-brand-300 dark:bg-brand-700', dot: 'bg-brand-300 dark:bg-brand-700', text: 'text-ink-2' },
  NEGOTIATION: { bar: 'bg-brand-400 dark:bg-brand-500', dot: 'bg-brand-400 dark:bg-brand-500', text: 'text-ink-2' },
  CLOSED:      { bar: 'bg-brand-600 dark:bg-brand-300', dot: 'bg-brand-600 dark:bg-brand-300', text: 'text-brand' },
};
