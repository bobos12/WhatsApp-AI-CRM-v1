import { downloadCsv } from './exportCsv';
import type { CustomFieldDefinition } from './custom-fields';

/** The contact row as `/api/contacts` returns it — every stored column. */
export interface ExportableContact {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  status?: string | null;
  lifecycleStage?: string | null;
  source?: string | null;
  notes?: string | null;
  marketingOptOut?: boolean | null;
  optOutAt?: string | null;
  consentAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  contactTags?: Array<{ tag: { name: string } }>;
  customFields?: Record<string, unknown> | null;
}

type T = (key: string) => string;

const date = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : '');

/** One custom-field value as a person would read it: choice labels, not stored keys. */
function fieldValue(def: CustomFieldDefinition, raw: unknown, t: T): string {
  if (raw === null || raw === undefined || raw === '') return '';
  const label = (v: unknown) => def.options?.find((o) => o.value === v)?.label ?? String(v);
  switch (def.type) {
    case 'MULTI_SELECT': return (Array.isArray(raw) ? raw : [raw]).map(label).join('; ');
    case 'SELECT': return label(raw);
    case 'CHECKBOX': return raw === true || raw === 'true' ? t('export.yes') : t('export.no');
    case 'DATE': return date(raw);
    default: return Array.isArray(raw) ? raw.join('; ') : String(raw);
  }
}

/**
 * Every contact with every saved field — built-ins, tags, each custom field and
 * consent — as a CSV that opens correctly in Excel (Arabic included).
 */
export function exportContacts(contacts: ExportableContact[], defs: CustomFieldDefinition[], t: T) {
  const fields = defs.filter((d) => d.isActive !== false).sort((a, b) => a.order - b.order);
  const headers = [
    t('export.cols.name'), t('export.cols.phone'), t('export.cols.email'), t('export.cols.company'),
    t('export.cols.status'), t('export.cols.stage'), t('export.cols.source'), t('export.cols.tags'), t('export.cols.notes'),
    ...fields.map((f) => f.label),
    t('export.cols.optOut'), t('export.cols.optOutAt'), t('export.cols.consentAt'),
    t('export.cols.createdAt'), t('export.cols.updatedAt'),
  ];
  const rows = contacts.map((c) => [
    c.name ?? '',
    c.phone ? (c.phone.startsWith('+') ? c.phone : `+${c.phone.replace(/\D/g, '')}`) : '',
    c.email ?? '', c.company ?? '', c.status ?? '', c.lifecycleStage ?? '', c.source ?? '',
    (c.contactTags ?? []).map((ct) => ct.tag.name).join('; '),
    c.notes ?? '',
    ...fields.map((f) => fieldValue(f, c.customFields?.[f.key], t)),
    c.marketingOptOut ? t('export.yes') : t('export.no'),
    date(c.optOutAt), date(c.consentAt), date(c.createdAt), date(c.updatedAt),
  ]);
  downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}
