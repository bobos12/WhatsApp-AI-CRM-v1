/**
 * How a campaign fills the blanks ({{1}}, {{name}}, …) of an approved template.
 *
 * Shared by the composer (which writes the choice) and the sender (which reads
 * it), stored on the campaign as a flat string map so existing rows keep working:
 *
 *   "1"           → "name"            the recipient's name
 *   "1::fallback" → "عميلنا العزيز"   used when that field is empty
 *   "2"           → "text:Webinar"    the same text for everyone
 *
 * Meta refuses a template send whose blank is empty, so a blank must always end
 * up with a value: a field that is empty for one recipient falls back rather
 * than failing that recipient.
 */

export type BlankSource =
  | { kind: 'field'; field: string; fallback: string }
  | { kind: 'text'; text: string }
  | { kind: 'unset' };

/**
 * Contact fields every account has. Must match `buildPersonalizationVars` on the
 * server; custom fields are added to these at runtime.
 */
export const CONTACT_FIELDS = ['name', 'first_name', 'phone', 'email', 'company'] as const;

const TEXT_PREFIX = 'text:';
const FALLBACK_SUFFIX = '::fallback';

/** What the campaign says about one blank. */
export function readBlank(
  mapping: Record<string, string> | null | undefined,
  slot: string,
  knownFields: readonly string[],
): BlankSource {
  const raw = mapping?.[slot];
  if (raw && raw.startsWith(TEXT_PREFIX)) return { kind: 'text', text: raw.slice(TEXT_PREFIX.length) };
  const field = raw || (knownFields.includes(slot) ? slot : '');
  if (!field) return { kind: 'unset' };
  return { kind: 'field', field, fallback: mapping?.[slot + FALLBACK_SUFFIX] ?? '' };
}

/** A copy of `mapping` with one blank set to `source`. */
export function writeBlank(
  mapping: Record<string, string>,
  slot: string,
  source: BlankSource,
): Record<string, string> {
  const next = { ...mapping };
  delete next[slot];
  delete next[slot + FALLBACK_SUFFIX];
  if (source.kind === 'text') next[slot] = TEXT_PREFIX + source.text;
  if (source.kind === 'field') {
    next[slot] = source.field;
    if (source.fallback) next[slot + FALLBACK_SUFFIX] = source.fallback;
  }
  return next;
}

/** True when the blank will always have something in it. */
export function isBlankFilled(source: BlankSource): boolean {
  if (source.kind === 'text') return source.text.trim().length > 0;
  return source.kind === 'field';
}

const NAME_FIELDS = ['name', 'first_name'];

/**
 * What goes in a blank whose field is empty and that has no fallback of its own.
 * A greeting reads naturally without a name; anything else gets a dash, which
 * Meta accepts and which is less jarring than a failed message.
 */
export function defaultFallback(field: string, language: string | null | undefined): string {
  const arabic = (language ?? '').toLowerCase().startsWith('ar');
  if (NAME_FIELDS.includes(field)) return arabic ? 'عميلنا العزيز' : 'there';
  return '-';
}

/** The value a recipient sees in this blank. Never empty. */
export function fillBlank(
  source: BlankSource,
  values: Record<string, string>,
  language: string | null | undefined,
): string {
  if (source.kind === 'text') return source.text.trim() || '-';
  if (source.kind === 'unset') return '-';
  return (
    values[source.field]?.trim() ||
    source.fallback.trim() ||
    defaultFallback(source.field, language)
  );
}
