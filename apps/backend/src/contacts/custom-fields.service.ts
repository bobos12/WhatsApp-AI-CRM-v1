import { prisma } from '../lib/prisma';
import { getTenantId } from '../lib/tenant-context';
import { normalizePhone } from '../lib/phone';
import { HttpError } from '../auth/authorize';
import {
  CHOICE_FIELD_TYPES,
  RESERVED_CUSTOM_FIELD_KEYS,
  slugifyFieldKey,
  validateFieldKey,
  type CustomFieldDefinitionDto,
  type CustomFieldOption,
  type CustomFieldType,
} from './custom-fields.constants';

/**
 * ─── Custom contact fields ───────────────────────────────────────────────────
 *
 * Definitions live in their own table; *values* live in `Contact.customFields`
 * JSON keyed by `definition.key`. That shape was chosen over an EAV value table
 * because every read path in this CRM loads whole contacts (lists, broadcasts,
 * exports, the chat sidebar) — a join per field would multiply those queries by
 * the number of fields a business defines, and businesses are expected to define
 * many. Postgres can still index and filter into JSONB when a query needs to.
 *
 * The tradeoff: values are only as well-typed as what we wrote. So *every*
 * write goes through `coerceCustomFieldValues`, which is the one place that
 * decides what a stored value looks like for each field type. Readers
 * (personalization, exports, the UI) may then assume:
 *
 *   TEXT | NOTES | EMAIL | PHONE | URL | DATE | SELECT → string
 *   NUMBER | CURRENCY                                  → number
 *   CHECKBOX                                           → boolean
 *   MULTI_SELECT                                       → string[]
 *
 * DATE is stored as a zone-free "YYYY-MM-DD" calendar date, not a timestamp: a
 * birthday is the same day everywhere, and storing it as an instant would drift
 * across timezones exactly the way scheduled broadcasts used to.
 */

const TEXT_MAX = 500;
const NOTES_MAX = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Definition CRUD ──────────────────────────────────────────────────────────

function parseOptions(raw: unknown): CustomFieldOption[] | null {
  if (!Array.isArray(raw)) return null;
  const options: CustomFieldOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const value = String((entry as any).value ?? '').trim();
    if (!value) continue;
    options.push({
      value,
      label: String((entry as any).label ?? value).trim() || value,
      ...((entry as any).color ? { color: String((entry as any).color) } : {}),
    });
  }
  return options.length ? options : null;
}

export function toDefinitionDto(row: any): CustomFieldDefinitionDto {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as CustomFieldType,
    options: parseOptions(row.options),
    required: row.required,
    defaultValue: row.defaultValue ?? null,
    placeholder: row.placeholder ?? null,
    helpText: row.helpText ?? null,
    currency: row.currency ?? null,
    order: row.order,
    isActive: row.isActive,
  };
}

/** Team scoping mirrors Tag/MessageTemplate: a null-team definition is global. */
function teamScope(teamId?: string | null) {
  return teamId ? { OR: [{ teamId }, { teamId: null }] } : {};
}

export async function listDefinitions(
  teamId?: string | null,
  opts: { includeInactive?: boolean } = {},
): Promise<CustomFieldDefinitionDto[]> {
  const rows = await prisma.customFieldDefinition.findMany({
    where: {
      ...teamScope(teamId),
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toDefinitionDto);
}

export interface DefinitionInput {
  key?: string;
  label: string;
  type: CustomFieldType;
  options?: unknown;
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string | null;
  helpText?: string | null;
  currency?: string | null;
}

function assertChoiceOptions(type: CustomFieldType, options: CustomFieldOption[] | null) {
  if (CHOICE_FIELD_TYPES.has(type) && (!options || options.length === 0)) {
    throw new HttpError(400, `${type} fields need at least one option.`);
  }
}

export async function createDefinition(teamId: string | null, input: DefinitionInput) {
  const label = input.label?.trim();
  if (!label) throw new HttpError(400, 'Label is required.');

  const key = (input.key?.trim() || slugifyFieldKey(label));
  const keyError = validateFieldKey(key);
  if (keyError) throw new HttpError(400, keyError);

  const existing = await prisma.customFieldDefinition.findFirst({
    where: { ...teamScope(teamId), key },
  });
  if (existing) throw new HttpError(409, `A field with the key "${key}" already exists.`);

  const options = parseOptions(input.options);
  assertChoiceOptions(input.type, options);

  const last = await prisma.customFieldDefinition.findFirst({
    where: teamScope(teamId),
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const row = await prisma.customFieldDefinition.create({
    data: {
      teamId,
      key,
      label,
      type: input.type as any,
      options: (options ?? undefined) as any,
      required: input.required ?? false,
      defaultValue: (input.defaultValue ?? undefined) as any,
      placeholder: input.placeholder?.trim() || null,
      helpText: input.helpText?.trim() || null,
      currency: input.currency?.trim().toUpperCase() || null,
      order: (last?.order ?? -1) + 1,
    },
  });
  return toDefinitionDto(row);
}

export async function updateDefinition(
  teamId: string | null,
  id: string,
  input: Partial<DefinitionInput> & { isActive?: boolean },
) {
  const existing = await prisma.customFieldDefinition.findFirst({
    where: { id, ...teamScope(teamId) },
  });
  if (!existing) throw new HttpError(404, 'Custom field not found.');

  // `key` is deliberately not updatable: every stored value on every contact is
  // addressed by it, and a rename would orphan all of them.
  const nextType = (input.type ?? existing.type) as CustomFieldType;
  const options = input.options !== undefined ? parseOptions(input.options) : parseOptions(existing.options);
  assertChoiceOptions(nextType, options);

  const row = await prisma.customFieldDefinition.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type as any } : {}),
      ...(input.options !== undefined ? { options: (options ?? null) as any } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.defaultValue !== undefined ? { defaultValue: (input.defaultValue ?? null) as any } : {}),
      ...(input.placeholder !== undefined ? { placeholder: input.placeholder?.trim() || null } : {}),
      ...(input.helpText !== undefined ? { helpText: input.helpText?.trim() || null } : {}),
      ...(input.currency !== undefined ? { currency: input.currency?.trim().toUpperCase() || null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return toDefinitionDto(row);
}

/**
 * Deleting a definition drops the column from every form, but the values stay in
 * `Contact.customFields` unless `purgeValues` is set. Keeping them is the safe
 * default: a mis-click shouldn't destroy a business's data, and re-creating the
 * field with the same key restores everything.
 */
export async function deleteDefinition(
  teamId: string | null,
  id: string,
  opts: { purgeValues?: boolean } = {},
) {
  const existing = await prisma.customFieldDefinition.findFirst({
    where: { id, ...teamScope(teamId) },
  });
  if (!existing) throw new HttpError(404, 'Custom field not found.');

  await prisma.customFieldDefinition.delete({ where: { id } });

  if (opts.purgeValues) {
    // `-` drops the key from the jsonb document. Spelled `jsonb_exists(...)`
    // rather than the `?` operator, which a driver can mistake for a placeholder.
    // Raw SQL bypasses the tenant-guard, so the tenant filter is added explicitly
    // — without it this would purge the key from every tenant's contacts.
    const tenantId = getTenantId();
    await prisma.$executeRawUnsafe(
      `UPDATE "Contact" SET "customFields" = "customFields" - $1
       WHERE "customFields" IS NOT NULL
         AND jsonb_exists("customFields", $1)
         AND "tenantId" = $2
         ${teamId ? 'AND "teamId" = $3' : ''}`,
      ...(teamId ? [existing.key, tenantId, teamId] : [existing.key, tenantId]),
    );
  }

  return { id, purged: Boolean(opts.purgeValues) };
}

/** Persist a new display order. `ids` is the full ordered list. */
export async function reorderDefinitions(teamId: string | null, ids: string[]) {
  const owned = await prisma.customFieldDefinition.findMany({
    where: { id: { in: ids }, ...teamScope(teamId) },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((row) => row.id));
  const ordered = ids.filter((id) => ownedIds.has(id));

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.customFieldDefinition.update({ where: { id }, data: { order: index } }),
    ),
  );

  return listDefinitions(teamId, { includeInactive: true });
}

// ── Value coercion ───────────────────────────────────────────────────────────

export interface FieldValueError {
  key: string;
  label: string;
  message: string;
}

/** `undefined` means "clear this field"; anything else is the stored value. */
function coerceOne(
  def: CustomFieldDefinitionDto,
  raw: unknown,
): { value: unknown } | { error: string } {
  const isBlank =
    raw == null ||
    (typeof raw === 'string' && raw.trim() === '') ||
    (Array.isArray(raw) && raw.length === 0);

  if (isBlank) {
    if (def.required) return { error: `${def.label} is required.` };
    return { value: undefined };
  }

  switch (def.type) {
    case 'TEXT':
    case 'NOTES': {
      const text = String(raw).trim();
      const max = def.type === 'NOTES' ? NOTES_MAX : TEXT_MAX;
      if (text.length > max) return { error: `${def.label} must be ${max} characters or fewer.` };
      return { value: text };
    }

    case 'NUMBER':
    case 'CURRENCY': {
      let numeric: number;
      if (typeof raw === 'number') {
        numeric = raw;
      } else {
        // Tolerate what spreadsheets emit: "1,234.50", "$1,234.50", " 12 ".
        const cleaned = String(raw).replace(/[^\d.\-]/g, '');
        // Stripping non-digits from "abc" leaves "", and Number("") is 0 — which
        // would store a silent zero for a value that was never a number at all.
        if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
          return { error: `${def.label} must be a number.` };
        }
        numeric = Number(cleaned);
      }
      if (!Number.isFinite(numeric)) return { error: `${def.label} must be a number.` };
      return { value: def.type === 'CURRENCY' ? Math.round(numeric * 100) / 100 : numeric };
    }

    case 'EMAIL': {
      const email = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { error: `${def.label} must be a valid email address.` };
      return { value: email };
    }

    case 'PHONE': {
      const phone = normalizePhone(String(raw));
      if (!phone) return { error: `${def.label} must be a valid phone number.` };
      return { value: phone };
    }

    case 'URL': {
      const url = String(raw).trim();
      const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      try {
        const parsed = new URL(withScheme);
        if (!parsed.hostname.includes('.')) throw new Error('no tld');
        return { value: parsed.toString() };
      } catch {
        return { error: `${def.label} must be a valid URL.` };
      }
    }

    case 'DATE': {
      const value = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim();
      if (DATE_RE.test(value)) {
        const parsed = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime())) return { error: `${def.label} must be a valid date.` };
        // Reject "2026-02-31", which Date happily rolls over into March.
        if (parsed.toISOString().slice(0, 10) !== value) {
          return { error: `${def.label} must be a valid date.` };
        }
        return { value };
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return { error: `${def.label} must be a valid date (YYYY-MM-DD).` };
      return { value: parsed.toISOString().slice(0, 10) };
    }

    case 'CHECKBOX': {
      if (typeof raw === 'boolean') return { value: raw };
      const text = String(raw).trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'on'].includes(text)) return { value: true };
      if (['false', 'no', 'n', '0', 'off'].includes(text)) return { value: false };
      return { error: `${def.label} must be yes or no.` };
    }

    case 'SELECT': {
      const value = String(raw).trim();
      const match = (def.options ?? []).find(
        (option) => option.value === value || option.label.toLowerCase() === value.toLowerCase(),
      );
      if (!match) return { error: `${def.label} must be one of: ${(def.options ?? []).map((o) => o.label).join(', ')}.` };
      return { value: match.value };
    }

    case 'MULTI_SELECT': {
      // Accepts a real array, or the comma/semicolon-separated string a CSV gives us.
      const entries = Array.isArray(raw)
        ? raw.map((entry) => String(entry).trim())
        : String(raw).split(/[,;|]/).map((entry) => entry.trim());

      const chosen: string[] = [];
      for (const entry of entries.filter(Boolean)) {
        const match = (def.options ?? []).find(
          (option) => option.value === entry || option.label.toLowerCase() === entry.toLowerCase(),
        );
        if (!match) return { error: `${def.label}: "${entry}" is not one of the allowed options.` };
        if (!chosen.includes(match.value)) chosen.push(match.value);
      }
      if (!chosen.length) {
        if (def.required) return { error: `${def.label} is required.` };
        return { value: undefined };
      }
      return { value: chosen };
    }

    default: {
      // Exhaustiveness guard — a new CustomFieldType must add a branch above
      // rather than fall through to an unvalidated write.
      const unreachable: never = def.type;
      return { error: `Unsupported field type "${String(unreachable)}".` };
    }
  }
}

export interface CoercedCustomFields {
  /** Keys whose new value is `values[key]`. */
  values: Record<string, unknown>;
  /** Keys the caller explicitly sent as blank — distinct from keys they omitted. */
  cleared: string[];
  errors: FieldValueError[];
}

/**
 * Validate and coerce a bag of raw values against the active definitions.
 *
 * `partial` (a PATCH) only evaluates keys present in `input`; a full write
 * evaluates every definition so a missing required field is caught. Reserved
 * system keys in `input` are ignored rather than rejected — they arrive whenever
 * a client echoes a contact object back to us.
 *
 * `cleared` exists because "omitted" and "sent empty" must not mean the same
 * thing on a PATCH: the first leaves the stored value alone, the second erases it.
 */
export function coerceCustomFieldValues(
  definitions: CustomFieldDefinitionDto[],
  input: Record<string, unknown> | null | undefined,
  opts: { partial?: boolean } = {},
): CoercedCustomFields {
  const values: Record<string, unknown> = {};
  const cleared: string[] = [];
  const errors: FieldValueError[] = [];
  const raw = input ?? {};

  for (const def of definitions) {
    const present = Object.prototype.hasOwnProperty.call(raw, def.key);
    if (!present && opts.partial) continue;

    const result = coerceOne(def, present ? raw[def.key] : undefined);
    if ('error' in result) {
      errors.push({ key: def.key, label: def.label, message: result.error });
      continue;
    }
    if (result.value === undefined) cleared.push(def.key);
    else values[def.key] = result.value;
  }

  return { values, cleared, errors };
}

/**
 * Fold coerced values into a contact's existing JSON.
 *
 * Two classes of key survive untouched no matter what: reserved system keys
 * (the WhatsApp avatar cache) and values whose definition has been deleted —
 * removing a field from the schema must not destroy the data behind it on the
 * contact's next save.
 */
export function mergeCustomFields(
  existing: unknown,
  coerced: CoercedCustomFields,
  definitions: CustomFieldDefinitionDto[],
  opts: { partial?: boolean } = {},
): Record<string, unknown> {
  const current = (existing ?? {}) as Record<string, unknown>;
  const known = new Set(definitions.map((def) => def.key));
  const merged: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(current)) {
    if (RESERVED_CUSTOM_FIELD_KEYS.has(key) || !known.has(key)) merged[key] = value;
  }

  // On a PATCH, definitions the caller didn't mention keep their stored value.
  if (opts.partial) {
    for (const def of definitions) {
      if (Object.prototype.hasOwnProperty.call(current, def.key)) merged[def.key] = current[def.key];
    }
  }

  for (const [key, value] of Object.entries(coerced.values)) merged[key] = value;
  for (const key of coerced.cleared) delete merged[key];

  return merged;
}

/** Strip reserved system keys before a contact leaves the API. */
export function publicCustomFields(raw: unknown): Record<string, unknown> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!RESERVED_CUSTOM_FIELD_KEYS.has(key)) out[key] = value;
  }
  return out;
}
