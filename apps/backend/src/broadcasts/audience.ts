import { prisma } from '../lib/prisma';
import { normalizePhone } from '../lib/phone';
import { RESERVED_CUSTOM_FIELD_KEYS } from '../contacts/custom-fields.constants';

/**
 * ─── Broadcast audience resolution ───────────────────────────────────────────
 *
 * An audience is the union of three sources: phone numbers typed in by hand,
 * a legacy single-tag filter, and a structured condition set that can address
 * built-in contact columns *and* any custom field.
 *
 * Conditions are evaluated in memory rather than compiled into a JSONB `where`.
 * A business instance holds tens of thousands of contacts, not tens of millions,
 * so one indexed scan plus a predicate loop is both fast enough and far easier
 * to keep correct across eleven field types — a SQL translation would need a
 * distinct cast and null-semantics per operator per type. The SQL layer still
 * narrows by team and tag before anything reaches JavaScript.
 */

export const AUDIENCE_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'greater_than',
  'less_than',
  'in',
  'before',
  'after',
] as const;

export type AudienceOperator = (typeof AUDIENCE_OPERATORS)[number];

export interface AudienceCondition {
  /** A built-in column name, a custom-field key, or a `cf_`-prefixed key. */
  field: string;
  operator: AudienceOperator;
  value?: unknown;
}

export interface AudienceFilter {
  /** Tag names. A contact matches if it carries any of them. */
  tags?: string[];
  /** Whether every condition must hold, or just one. */
  match?: 'all' | 'any';
  conditions?: AudienceCondition[];
}

const BUILT_IN_ACCESSORS: Record<string, (contact: ContactRow) => unknown> = {
  name: (c) => c.name,
  phone: (c) => c.phone,
  email: (c) => c.email,
  company: (c) => c.company,
  notes: (c) => c.notes,
  status: (c) => c.status,
  lifecycleStage: (c) => c.lifecycleStage,
  source: (c) => c.source,
  createdAt: (c) => c.createdAt,
};

interface ContactRow {
  phone: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  status: string;
  lifecycleStage: string;
  source: string | null;
  createdAt: Date;
  customFields: unknown;
}

function readField(contact: ContactRow, field: string): unknown {
  const accessor = BUILT_IN_ACCESSORS[field];
  if (accessor) return accessor(contact);

  const key = field.startsWith('cf_') ? field.slice(3) : field;
  if (RESERVED_CUSTOM_FIELD_KEYS.has(key)) return undefined;
  return ((contact.customFields ?? {}) as Record<string, unknown>)[key];
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Comparable scalar for ordering operators. Dates sort as epoch ms. */
function toComparable(value: unknown): number | string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const text = String(value);
  const asNumber = Number(text);
  if (text.trim() !== '' && Number.isFinite(asNumber)) return asNumber;

  const asDate = Date.parse(text);
  if (!Number.isNaN(asDate)) return asDate;

  return text.toLowerCase();
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(textOf).join(', ');
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compare(actual: unknown, expected: unknown): number | null {
  const left = toComparable(actual);
  const right = toComparable(expected);
  if (left == null || right == null) return null;
  if (typeof left !== typeof right) return null;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function evaluateCondition(contact: ContactRow, condition: AudienceCondition): boolean {
  const actual = readField(contact, condition.field);
  const { operator, value } = condition;

  switch (operator) {
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);

    case 'equals':
      // A MULTI_SELECT "equals x" reads naturally as "contains the option x".
      if (Array.isArray(actual)) return actual.some((entry) => textOf(entry).toLowerCase() === textOf(value).toLowerCase());
      if (typeof actual === 'boolean') return actual === (value === true || value === 'true');
      return textOf(actual).toLowerCase() === textOf(value).toLowerCase();

    case 'not_equals':
      return !evaluateCondition(contact, { ...condition, operator: 'equals' });

    case 'contains':
      return textOf(actual).toLowerCase().includes(textOf(value).toLowerCase());
    case 'not_contains':
      return !textOf(actual).toLowerCase().includes(textOf(value).toLowerCase());

    case 'in': {
      const allowed = Array.isArray(value) ? value : String(value ?? '').split(',');
      const wanted = allowed.map((entry) => textOf(entry).trim().toLowerCase()).filter(Boolean);
      if (Array.isArray(actual)) return actual.some((entry) => wanted.includes(textOf(entry).toLowerCase()));
      return wanted.includes(textOf(actual).toLowerCase());
    }

    case 'greater_than':
    case 'after': {
      const result = compare(actual, value);
      return result !== null && result > 0;
    }
    case 'less_than':
    case 'before': {
      const result = compare(actual, value);
      return result !== null && result < 0;
    }

    default: {
      const unreachable: never = operator;
      throw new Error(`Unsupported audience operator "${String(unreachable)}".`);
    }
  }
}

export function matchesFilter(contact: ContactRow, filter: AudienceFilter): boolean {
  const conditions = filter.conditions ?? [];
  if (!conditions.length) return true;
  return filter.match === 'any'
    ? conditions.some((condition) => evaluateCondition(contact, condition))
    : conditions.every((condition) => evaluateCondition(contact, condition));
}

export interface AudienceInput {
  recipients?: string[];
  /** Legacy single-tag targeting, kept so existing broadcasts keep resolving. */
  tag?: string;
  filter?: AudienceFilter | null;
  teamId?: string | null;
}

export interface ResolvedAudience {
  /** Deliverable, E.164-normalized, deduplicated. */
  phones: string[];
  /** How many entries the request nominally contained, before any cleaning. */
  requested: number;
  /** Entries that are not usable phone numbers at all. */
  invalid: string[];
  /**
   * How many entries collapsed into an existing number once normalized. Almost
   * always a person listed twice in different formats — and, before this,
   * a person who received the campaign twice.
   */
  duplicates: number;
}

/**
 * Resolve an audience definition into deliverable E.164 numbers.
 *
 * Normalization is the point. The old resolver deduplicated raw strings, so
 * "+971501234567", "971501234567" and "0501234567" were three distinct
 * recipients — one human, three messages, in a single campaign. WhatsApp reads
 * that as a duplicate-send pattern and the recipient reads it as spam; both are
 * right. Everything downstream (suppression, cooldown, per-contact history) keys on
 * phone, so a non-canonical number silently escapes every one of those checks.
 */
export async function resolveAudienceDetailed(input: AudienceInput): Promise<ResolvedAudience> {
  const rawDirect = (input.recipients ?? []).map((phone) => phone.trim()).filter(Boolean);
  const legacyTag = input.tag?.trim();
  const filter = input.filter ?? undefined;
  const filterTags = (filter?.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const hasConditions = Boolean(filter?.conditions?.length);

  const rawMatched: string[] = [];

  if (legacyTag || filterTags.length || hasConditions) {
    const tagNames = Array.from(new Set([...(legacyTag ? [legacyTag] : []), ...filterTags]));

    const contacts = await prisma.contact.findMany({
      where: {
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(tagNames.length
          ? { contactTags: { some: { tag: { name: { in: tagNames, mode: 'insensitive' } } } } }
          : {}),
        // Opted-out contacts never enter an audience. Filtering here rather than
        // only at send time means the count the user is shown is the truth.
        marketingOptOut: false,
      },
      select: {
        phone: true,
        name: true,
        email: true,
        company: true,
        notes: true,
        status: true,
        lifecycleStage: true,
        source: true,
        createdAt: true,
        customFields: true,
      },
    });

    for (const contact of contacts) {
      if (!contact.phone) continue;
      if (filter && !matchesFilter(contact, filter)) continue;
      rawMatched.push(contact.phone);
    }
  }

  const all = [...rawDirect, ...rawMatched];
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicates = 0;

  for (const entry of all) {
    const normalized = normalizePhone(entry);
    if (!normalized) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates += 1;
      continue;
    }
    seen.add(normalized);
  }

  return {
    phones: Array.from(seen),
    requested: all.length,
    invalid,
    duplicates,
  };
}

/** Back-compatible shape: just the deliverable numbers. */
export async function resolveAudience(input: AudienceInput): Promise<string[]> {
  const { phones } = await resolveAudienceDetailed(input);
  return phones;
}
