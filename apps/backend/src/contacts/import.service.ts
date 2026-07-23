import { prisma } from '../lib/prisma';
import { normalizePhone } from '../lib/phone';
import { logger } from '../lib/logger';
import {
  coerceCustomFieldValues,
  listDefinitions,
  mergeCustomFields,
} from './custom-fields.service';
import type { CustomFieldDefinitionDto } from './custom-fields.constants';

/**
 * ─── Contact import ──────────────────────────────────────────────────────────
 *
 * The client parses the spreadsheet (it already has the bytes, and parsing there
 * gives an instant preview with no upload round-trip) and posts *mapped rows*:
 * `{ row, values: { phone, name, <custom key>, ... } }`. Everything after that —
 * phone normalization, type coercion, duplicate resolution, tag creation — lives
 * here, so the rules are identical whether a row arrives from the wizard, a
 * retry, or a future public API.
 *
 * `validateRows` is the same code path as `importRows` minus the writes, which
 * is what makes the preview trustworthy: what it says will happen, happens.
 */

export const DUPLICATE_STRATEGIES = ['SKIP', 'UPDATE', 'MERGE', 'CREATE_ONLY'] as const;
export type DuplicateStrategy = (typeof DUPLICATE_STRATEGIES)[number];

/** Virtual columns: not stored as-is, but folded into a real field. */
export const VIRTUAL_TARGETS = ['first_name', 'last_name', 'country_code'] as const;

export const BUILT_IN_TARGETS = [
  'phone',
  'name',
  'email',
  'company',
  'notes',
  'tags',
  'source',
  'lifecycleStage',
] as const;

/**
 * Header aliases for automatic column detection, lowercased and punctuation-free.
 * Arabic aliases are included because this CRM's primary market exports
 * spreadsheets with Arabic headers.
 */
const TARGET_ALIASES: Record<string, string[]> = {
  phone: [
    'phone', 'phone number', 'phonenumber', 'mobile', 'mobile number', 'mobile no',
    'whatsapp', 'whatsapp number', 'wa number', 'tel', 'telephone', 'cell', 'cellphone',
    'msisdn', 'contact number', 'number', 'رقم', 'رقم الهاتف', 'الهاتف', 'جوال', 'الجوال', 'موبايل', 'واتساب',
  ],
  country_code: ['country code', 'countrycode', 'dial code', 'dialcode', 'cc', 'country', 'كود الدولة', 'الدولة'],
  name: ['name', 'full name', 'fullname', 'contact name', 'customer name', 'client name', 'contact', 'اسم', 'الاسم', 'الاسم الكامل'],
  first_name: ['first name', 'firstname', 'given name', 'fname', 'الاسم الاول'],
  last_name: ['last name', 'lastname', 'surname', 'family name', 'lname', 'اسم العائلة'],
  email: ['email', 'e mail', 'email address', 'mail', 'بريد', 'البريد الالكتروني', 'الايميل'],
  company: ['company', 'company name', 'organization', 'organisation', 'org', 'business', 'account', 'employer', 'شركة', 'الشركة'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks', 'description', 'ملاحظات', 'ملاحظة'],
  tags: ['tags', 'tag', 'labels', 'label', 'segment', 'segments', 'group', 'groups', 'وسم', 'وسوم'],
  source: ['source', 'lead source', 'origin', 'channel', 'مصدر'],
  lifecycleStage: ['lifecycle stage', 'lifecycle', 'stage', 'status', 'lead status', 'المرحلة'],
};

/** Strip punctuation/underscores so "Phone_Number" and "phone number" collide. */
function normalizeHeader(header: string): string {
  return header
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ImportTarget {
  id: string;
  label: string;
  type: string;
  required: boolean;
  /** Present for SELECT / MULTI_SELECT so the wizard can show valid choices. */
  options?: Array<{ value: string; label: string }>;
  aliases: string[];
}

/**
 * Everything a spreadsheet column can be mapped onto: built-in contact columns,
 * the two virtual name halves, a country-code column, and every custom field.
 * Served to the wizard so column detection and the mapping UI stay in lockstep
 * with what the importer actually accepts.
 */
export async function listImportTargets(teamId?: string | null): Promise<ImportTarget[]> {
  const definitions = await listDefinitions(teamId ?? null);

  const builtIns: ImportTarget[] = [
    { id: 'phone', label: 'Phone', type: 'PHONE', required: true, aliases: TARGET_ALIASES.phone },
    { id: 'country_code', label: 'Country code', type: 'TEXT', required: false, aliases: TARGET_ALIASES.country_code },
    { id: 'name', label: 'Full name', type: 'TEXT', required: false, aliases: TARGET_ALIASES.name },
    { id: 'first_name', label: 'First name', type: 'TEXT', required: false, aliases: TARGET_ALIASES.first_name },
    { id: 'last_name', label: 'Last name', type: 'TEXT', required: false, aliases: TARGET_ALIASES.last_name },
    { id: 'email', label: 'Email', type: 'EMAIL', required: false, aliases: TARGET_ALIASES.email },
    { id: 'company', label: 'Company', type: 'TEXT', required: false, aliases: TARGET_ALIASES.company },
    { id: 'notes', label: 'Notes', type: 'NOTES', required: false, aliases: TARGET_ALIASES.notes },
    { id: 'tags', label: 'Tags', type: 'TEXT', required: false, aliases: TARGET_ALIASES.tags },
    { id: 'source', label: 'Source', type: 'TEXT', required: false, aliases: TARGET_ALIASES.source },
    { id: 'lifecycleStage', label: 'Lifecycle stage', type: 'TEXT', required: false, aliases: TARGET_ALIASES.lifecycleStage },
  ];

  const custom: ImportTarget[] = definitions.map((definition) => ({
    id: definition.key,
    label: definition.label,
    type: definition.type,
    required: definition.required,
    ...(definition.options ? { options: definition.options.map((o) => ({ value: o.value, label: o.label })) } : {}),
    // A custom field matches its own label and key, plus label-with-punctuation.
    aliases: [normalizeHeader(definition.label), normalizeHeader(definition.key)],
  }));

  return [...builtIns, ...custom];
}

/**
 * Best-guess mapping from spreadsheet headers to import targets.
 * Exact alias hit wins; otherwise a containment match, longest alias first, so
 * "Mobile Phone Number" prefers `phone` over a custom field called "Number".
 * Each target is claimed at most once.
 */
export function detectMapping(headers: string[], targets: ImportTarget[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const claimed = new Set<string>();

  const byAlias = new Map<string, string>();
  for (const target of targets) {
    for (const alias of target.aliases) {
      const key = normalizeHeader(alias);
      if (key && !byAlias.has(key)) byAlias.set(key, target.id);
    }
  }

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;

    const exact = byAlias.get(normalized);
    if (exact && !claimed.has(exact)) {
      mapping[index] = exact;
      claimed.add(exact);
      return;
    }

    const candidates = [...byAlias.entries()]
      .filter(([alias, targetId]) => !claimed.has(targetId) && (normalized.includes(alias) || alias.includes(normalized)))
      .sort((a, b) => b[0].length - a[0].length);

    if (candidates.length) {
      const [, targetId] = candidates[0];
      mapping[index] = targetId;
      claimed.add(targetId);
    }
  });

  return mapping;
}

// ── Row processing ───────────────────────────────────────────────────────────

export interface ImportRow {
  /** 1-based row number in the source file — what the error report points at. */
  row: number;
  values: Record<string, unknown>;
}

export interface ImportOptions {
  duplicateStrategy: DuplicateStrategy;
  /** ISO-3166 region used to parse phone numbers written without a country code. */
  defaultCountry?: string;
  createMissingTags?: boolean;
  source?: string;
}

export type RowOutcome = 'created' | 'updated' | 'merged' | 'skipped' | 'failed';

export interface RowResult {
  row: number;
  outcome: RowOutcome;
  phone?: string;
  contactId?: string;
  errors?: string[];
}

export interface ImportSummary {
  created: number;
  updated: number;
  merged: number;
  skipped: number;
  failed: number;
  results: RowResult[];
}

function text(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function isBlank(value: unknown): boolean {
  return text(value) === '';
}

/**
 * Merge a `country_code` column into the phone number when the number itself is
 * written locally. Accepts "20", "+20", "0020" or an ISO region like "EG".
 */
function applyCountryCode(rawPhone: string, rawCountry: string, fallbackRegion?: string): { phone: string; region?: string } {
  const country = rawCountry.trim();
  if (!country) return { phone: rawPhone, region: fallbackRegion };

  if (/^[A-Za-z]{2}$/.test(country)) {
    return { phone: rawPhone, region: country.toUpperCase() };
  }

  const digits = country.replace(/[^\d]/g, '').replace(/^00/, '');
  if (!digits) return { phone: rawPhone, region: fallbackRegion };

  // Already international — the column is redundant, don't double-prefix it.
  if (rawPhone.startsWith('+') || rawPhone.replace(/[^\d]/g, '').startsWith(digits)) {
    return { phone: rawPhone, region: fallbackRegion };
  }
  return { phone: `+${digits}${rawPhone.replace(/^0+/, '').replace(/[^\d]/g, '')}`, region: fallbackRegion };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface PreparedRow {
  row: number;
  phone: string;
  base: Record<string, unknown>;
  customInput: Record<string, unknown>;
  tags: string[];
  errors: string[];
}

/**
 * Turn one mapped row into a normalized, validated contact draft. Pure: no reads,
 * no writes — so preview and import agree by construction.
 */
function prepareRow(
  row: ImportRow,
  definitions: CustomFieldDefinitionDto[],
  options: ImportOptions,
): PreparedRow {
  const errors: string[] = [];
  const values = row.values ?? {};

  // ── Phone (the only required column) ──
  const rawPhone = text(values.phone);
  let phone = '';
  if (!rawPhone) {
    errors.push('Phone number is missing.');
  } else {
    const { phone: combined, region } = applyCountryCode(rawPhone, text(values.country_code), options.defaultCountry);
    const normalized = normalizePhone(combined, region || options.defaultCountry);
    if (!normalized) errors.push(`"${rawPhone}" is not a valid phone number.`);
    else phone = normalized;
  }

  // ── Name: explicit `name` wins, otherwise stitch the two halves together ──
  const first = text(values.first_name);
  const last = text(values.last_name);
  const name = text(values.name) || [first, last].filter(Boolean).join(' ');

  const email = text(values.email).toLowerCase();
  if (email && !EMAIL_RE.test(email)) errors.push(`"${email}" is not a valid email address.`);

  const base: Record<string, unknown> = {};
  if (name) base.name = name;
  if (email) base.email = email;
  if (!isBlank(values.company)) base.company = text(values.company);
  if (!isBlank(values.notes)) base.notes = text(values.notes);
  if (!isBlank(values.lifecycleStage)) base.lifecycleStage = text(values.lifecycleStage).toUpperCase();
  const source = text(values.source) || options.source;
  if (source) base.source = source;

  const tags = text(values.tags)
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  // ── Custom fields ──
  const customInput: Record<string, unknown> = {};
  for (const definition of definitions) {
    if (Object.prototype.hasOwnProperty.call(values, definition.key) && !isBlank(values[definition.key])) {
      customInput[definition.key] = values[definition.key];
    }
  }

  const coerced = coerceCustomFieldValues(definitions, customInput, { partial: true });
  errors.push(...coerced.errors.map((error) => error.message));

  return { row: row.row, phone, base, customInput: coerced.values, tags, errors };
}

/** Required custom fields are enforced only on rows that create a new contact. */
function missingRequiredFields(
  prepared: PreparedRow,
  definitions: CustomFieldDefinitionDto[],
): string[] {
  return definitions
    .filter((definition) => definition.required && !(definition.key in prepared.customInput))
    .map((definition) => `${definition.label} is required.`);
}

export interface ValidationRowResult {
  row: number;
  phone?: string;
  /** What `importRows` would do with this row, given the current options. */
  outcome: 'create' | 'update' | 'merge' | 'skip' | 'error';
  duplicateOf?: 'file' | 'database';
  existingName?: string | null;
  errors: string[];
}

/** Dry run: exactly the checks `importRows` performs, with nothing written. */
export async function validateRows(
  rows: ImportRow[],
  options: ImportOptions,
  teamId?: string | null,
): Promise<{ results: ValidationRowResult[]; targets: ImportTarget[] }> {
  const definitions = await listDefinitions(teamId ?? null);
  const prepared = rows.map((row) => prepareRow(row, definitions, options));

  const phones = prepared.map((row) => row.phone).filter(Boolean);
  const existing = phones.length
    ? await prisma.contact.findMany({
        where: { phone: { in: phones } },
        select: { phone: true, name: true },
      })
    : [];
  const existingByPhone = new Map(existing.map((contact) => [contact.phone, contact]));

  // Which row first claimed each number, so an in-file duplicate can point at it.
  // "This contact already exists" is a lie when the only thing it collides with is
  // row 12 of the same spreadsheet, and it sends people hunting through a contact
  // list that has nothing in it.
  const firstRowByPhone = new Map<string, number>();
  const results: ValidationRowResult[] = prepared.map((row) => {
    const errors = [...row.errors];
    let duplicateOf: 'file' | 'database' | undefined;
    let firstRow: number | undefined;

    if (row.phone) {
      firstRow = firstRowByPhone.get(row.phone);
      if (firstRow !== undefined) duplicateOf = 'file';
      else firstRowByPhone.set(row.phone, row.row);
    }

    const dbMatch = row.phone ? existingByPhone.get(row.phone) : undefined;
    if (dbMatch && !duplicateOf) duplicateOf = 'database';

    if (!dbMatch && !duplicateOf) errors.push(...missingRequiredFields(row, definitions));

    if (errors.length) {
      return { row: row.row, phone: row.phone || undefined, outcome: 'error', duplicateOf, errors };
    }

    // An in-file duplicate collapses onto the earlier row; the strategy decides
    // what happens to the second occurrence exactly as if the first had landed.
    const isDuplicate = Boolean(dbMatch) || duplicateOf === 'file';
    if (!isDuplicate) {
      return { row: row.row, phone: row.phone, outcome: 'create', errors: [] };
    }

    switch (options.duplicateStrategy) {
      case 'SKIP':
        return { row: row.row, phone: row.phone, outcome: 'skip', duplicateOf, existingName: dbMatch?.name, errors: [] };
      case 'CREATE_ONLY':
        return {
          row: row.row,
          phone: row.phone,
          outcome: 'error',
          duplicateOf,
          existingName: dbMatch?.name,
          errors: [
            duplicateOf === 'file'
              ? `This number is repeated in your file — row ${firstRow} already has it.`
              : 'This contact already exists.',
          ],
        };
      case 'MERGE':
        return { row: row.row, phone: row.phone, outcome: 'merge', duplicateOf, existingName: dbMatch?.name, errors: [] };
      case 'UPDATE':
      default:
        return { row: row.row, phone: row.phone, outcome: 'update', duplicateOf, existingName: dbMatch?.name, errors: [] };
    }
  });

  return { results, targets: await listImportTargets(teamId) };
}

// ── Tags ─────────────────────────────────────────────────────────────────────

async function resolveTagIds(
  names: string[],
  teamId: string | null,
  cache: Map<string, string>,
  createMissing: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached) {
      ids.push(cached);
      continue;
    }

    let tag = await prisma.tag.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(teamId ? { teamId } : {}) },
      select: { id: true },
    });

    if (!tag && createMissing) {
      tag = await prisma.tag.create({ data: { name, teamId }, select: { id: true } });
    }
    if (tag) {
      cache.set(key, tag.id);
      ids.push(tag.id);
    }
  }
  return ids;
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Only fill columns the existing contact has left empty. */
function mergeBase(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (isBlank(existing[key])) data[key] = value;
  }
  return data;
}

/**
 * Apply one batch of rows. The wizard streams batches so progress is real; each
 * batch is independent, so a failure late in a large file never rolls back the
 * contacts already imported.
 */
export async function importRows(
  rows: ImportRow[],
  options: ImportOptions,
  teamId?: string | null,
): Promise<ImportSummary> {
  const definitions = await listDefinitions(teamId ?? null);
  const tagCache = new Map<string, string>();
  const createMissingTags = options.createMissingTags ?? true;

  const summary: ImportSummary = { created: 0, updated: 0, merged: 0, skipped: 0, failed: 0, results: [] };
  /** Phone → the row in this batch that first claimed it (see `validateRows`). */
  const seenInBatch = new Map<string, number>();

  for (const raw of rows) {
    const prepared = prepareRow(raw, definitions, options);

    if (prepared.errors.length) {
      summary.failed += 1;
      summary.results.push({ row: prepared.row, outcome: 'failed', errors: prepared.errors });
      continue;
    }

    try {
      const existing = await prisma.contact.findFirst({ where: { phone: prepared.phone } });
      const firstRow = seenInBatch.get(prepared.phone);
      const isDuplicate = Boolean(existing) || firstRow !== undefined;
      if (firstRow === undefined) seenInBatch.set(prepared.phone, prepared.row);

      if (isDuplicate && options.duplicateStrategy === 'SKIP') {
        summary.skipped += 1;
        summary.results.push({ row: prepared.row, outcome: 'skipped', phone: prepared.phone });
        continue;
      }

      if (isDuplicate && options.duplicateStrategy === 'CREATE_ONLY') {
        summary.failed += 1;
        summary.results.push({
          row: prepared.row,
          outcome: 'failed',
          phone: prepared.phone,
          errors: [
            firstRow !== undefined && !existing
              ? `This number is repeated in your file — row ${firstRow} already has it.`
              : 'This contact already exists.',
          ],
        });
        continue;
      }

      if (!existing) {
        const missing = missingRequiredFields(prepared, definitions);
        if (missing.length) {
          summary.failed += 1;
          summary.results.push({ row: prepared.row, outcome: 'failed', phone: prepared.phone, errors: missing });
          continue;
        }
      }

      const coerced = { values: prepared.customInput, cleared: [], errors: [] };
      let contactId: string;
      let outcome: RowOutcome;

      if (!existing) {
        const created = await prisma.contact.create({
          data: {
            phone: prepared.phone,
            teamId: teamId ?? undefined,
            ...prepared.base,
            customFields: mergeCustomFields(null, coerced, definitions, { partial: true }) as any,
          },
        });
        contactId = created.id;
        outcome = 'created';
        summary.created += 1;
      } else {
        const merge = options.duplicateStrategy === 'MERGE';
        const baseData = merge ? mergeBase(existing as any, prepared.base) : prepared.base;

        // MERGE never overwrites a custom-field value that already has content.
        const customValues = merge
          ? Object.fromEntries(
              Object.entries(prepared.customInput).filter(
                ([key]) => isBlank(((existing.customFields ?? {}) as Record<string, unknown>)[key]),
              ),
            )
          : prepared.customInput;

        const updated = await prisma.contact.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            customFields: mergeCustomFields(
              existing.customFields,
              { values: customValues, cleared: [], errors: [] },
              definitions,
              { partial: true },
            ) as any,
          },
        });
        contactId = updated.id;
        outcome = merge ? 'merged' : 'updated';
        if (merge) summary.merged += 1;
        else summary.updated += 1;
      }

      if (prepared.tags.length) {
        const tagIds = await resolveTagIds(prepared.tags, teamId ?? null, tagCache, createMissingTags);
        if (tagIds.length) {
          await prisma.contactTag.createMany({
            data: tagIds.map((tagId) => ({ contactId, tagId })),
            skipDuplicates: true,
          });
        }
      }

      summary.results.push({ row: prepared.row, outcome, phone: prepared.phone, contactId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('contacts.import_row_failed', { row: prepared.row, error: message });
      summary.failed += 1;
      summary.results.push({ row: prepared.row, outcome: 'failed', phone: prepared.phone, errors: [message] });
    }
  }

  return summary;
}
