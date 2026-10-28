import type { NotificationType } from '@prisma/client';

/**
 * The switches a person sees in Settings → Notifications. Every notification
 * type belongs to exactly one, except TEST, which always goes through.
 */
export const NOTIFY_CATEGORIES = [
  'messages',
  'assignments',
  'mentions',
  'comments',
  'reviews',
  'deadlines',
  'reminders',
] as const;
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

export const CATEGORY_OF: Record<NotificationType, NotifyCategory | null> = {
  MESSAGE: 'messages',
  ASSIGNMENT: 'assignments',
  MENTION: 'mentions',
  NOTE: 'comments',
  BUYING_INTENT: 'reviews',
  NEEDS_ATTENTION: 'reviews',
  STATUS_UPGRADE: 'reviews',
  TASK_DUE: 'deadlines',
  REMINDER: 'reminders',
  TEST: null,
};

/** Alerts a person should hear about right away (sent with high push urgency). */
export const HIGH_PRIORITY_TYPES = new Set<NotificationType>(['MESSAGE', 'MENTION', 'ASSIGNMENT', 'REMINDER']);

export type Bilingual = { en: string; ar: string };

const BILINGUAL_DELIM = '␟'; // unit separator — won't appear in normal text

export function pack(value: Bilingual): string {
  return `${value.en}${BILINGUAL_DELIM}${value.ar}`;
}

/** Split a packed "en␟ar" string into { en, ar }; tolerant of legacy plain text. */
export function unpackBilingual(value: string | null): Bilingual {
  if (!value) return { en: '', ar: '' };
  const idx = value.indexOf(BILINGUAL_DELIM);
  if (idx === -1) return { en: value, ar: value };
  return { en: value.slice(0, idx), ar: value.slice(idx + 1) };
}
