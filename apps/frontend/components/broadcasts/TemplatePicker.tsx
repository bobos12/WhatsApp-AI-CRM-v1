'use client';

/**
 * Choose the approved template a campaign sends, and fill in its blanks.
 *
 * This exists because a broadcast audience is by definition outside the 24-hour
 * customer service window, where WhatsApp accepts nothing but a template it has
 * approved. So the template is not a convenience here, it is the payload.
 *
 * Only APPROVED templates are selectable. The others are listed as disabled with
 * their real state, because "I made that template, why isn't it here" is
 * otherwise unanswerable.
 *
 * Every blank must end up with a value — Meta refuses the whole message when one
 * is empty. A blank is filled either from a contact detail (with a backup for
 * contacts who don't have it) or with the same text for everyone; until one is
 * chosen the blank is flagged and the campaign cannot be sent.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Search, Video, X } from 'lucide-react';
import { templateExtras } from '../../lib/template-engine/compiler';
import {
  CONTACT_FIELDS,
  defaultFallback,
  isBlankFilled,
  readBlank,
  writeBlank,
  type BlankSource,
} from '@crm/messaging-schema';
import { ApprovalBadge, type MetaStatus } from '../templates/ApprovalStatus';
import { cn } from '../../lib/utils';

export interface PickableTemplate {
  id: string;
  name: string;
  content: string;
  language?: string;
  variables?: string[] | null;
  mediaType?: string | null;
  metaStatus?: MetaStatus;
  metaRejectedReason?: string | null;
  /** Canonical payload — carries the footer and buttons. */
  payload?: unknown;
}

const CHIP_ICONS = { QUICK_REPLY: Reply, URL: ExternalLink, PHONE_NUMBER: Phone, COPY_CODE: Copy } as const;

/** The template's buttons as small labels, so two similar templates are told apart at a glance. */
function ButtonChips({ payload }: { payload?: unknown }) {
  const { buttons } = templateExtras(payload);
  if (!buttons?.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {buttons.slice(0, 3).map((b, i) => {
        const Icon = CHIP_ICONS[b.type];
        return (
          <span key={i} dir="auto" className="inline-flex max-w-[10rem] items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2">
            <Icon className="h-3 w-3 shrink-0 text-[#027EB5] dark:text-[#53BDEB]" aria-hidden="true" />
            <span className="truncate">{b.type === 'COPY_CODE' ? b.example : b.text}</span>
          </span>
        );
      })}
      {buttons.length > 3 && (
        <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">+{buttons.length - 3}</span>
      )}
    </span>
  );
}

/** The value of the "same text for everyone" option in the source select. */
const FIXED_TEXT = '__text__';

export function templateVariableNames(template: PickableTemplate | null | undefined): string[] {
  if (!template) return [];
  if (Array.isArray(template.variables) && template.variables.length) {
    return template.variables.filter((v): v is string => typeof v === 'string');
  }
  // Fall back to the body text so a template saved before `variables` was
  // populated still shows its placeholders rather than pretending it has none.
  const found = new Set<string>();
  for (const match of (template.content ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)) found.add(match[1]);
  return [...found];
}

/** Field keys a blank can be filled from: the built-ins, then custom fields. */
export function knownFieldKeys(customFields?: Array<{ key: string }>): string[] {
  return [...CONTACT_FIELDS, ...(customFields ?? []).map((f) => f.key)];
}

/** True when every blank of the template has a value source. */
export function templateBlanksFilled(
  template: PickableTemplate | null | undefined,
  mapping: Record<string, string>,
  customFields?: Array<{ key: string }>,
): boolean {
  const known = knownFieldKeys(customFields);
  return templateVariableNames(template).every((slot) => isBlankFilled(readBlank(mapping, slot, known)));
}

/**
 * The body as one recipient would read it. `sample` holds that recipient's
 * details; without one, a field shows as its label in brackets.
 */
export function renderTemplatePreview(
  template: PickableTemplate,
  mapping: Record<string, string>,
  options: {
    customFields?: Array<{ key: string; label: string }>;
    labelFor: (field: string) => string;
    sample?: Record<string, string> | null;
  },
): string {
  const known = knownFieldKeys(options.customFields);
  return (template.content ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_all, slot: string) => {
    const blank = readBlank(mapping, slot, known);
    if (blank.kind === 'text') return blank.text.trim() || '…';
    if (blank.kind === 'unset') return '…';
    if (options.sample) {
      return (
        options.sample[blank.field]?.trim() ||
        blank.fallback.trim() ||
        defaultFallback(blank.field, template.language)
      );
    }
    return `[${options.labelFor(blank.field)}]`;
  });
}

export default function TemplatePicker({
  templates,
  value,
  variableMapping,
  customFields,
  onChange,
  onMappingChange,
  autoOpen,
}: {
  templates: PickableTemplate[];
  value: string | null;
  variableMapping: Record<string, string>;
  /** Tenant custom fields, offered alongside the built-ins. */
  customFields?: Array<{ key: string; label: string }>;
  onChange: (templateId: string | null) => void;
  onMappingChange: (mapping: Record<string, string>) => void;
  /** Open the list on mount — used when arriving from the pre-flight fix. */
  autoOpen?: boolean;
}) {
  const { t } = useTranslation('broadcasts');
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [search, setSearch] = useState('');

  const fields = useMemo(
    () => [
      ...CONTACT_FIELDS.map((key) => ({
        value: key as string,
        label: t(`template.field${key.replace(/_(.)/g, (_m, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`),
      })),
      ...(customFields ?? [])
        .filter((cf) => !CONTACT_FIELDS.some((k) => k === cf.key))
        .map((cf) => ({ value: cf.key, label: cf.label })),
    ],
    [customFields, t],
  );
  const known = useMemo(() => fields.map((f) => f.value), [fields]);
  const labelFor = (field: string) => fields.find((f) => f.value === field)?.label ?? field;

  const approved = useMemo(() => templates.filter((tpl) => tpl.metaStatus === 'APPROVED'), [templates]);
  const unapproved = useMemo(() => templates.filter((tpl) => tpl.metaStatus !== 'APPROVED'), [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return approved;
    return approved.filter(
      (tpl) => tpl.name.toLowerCase().includes(q) || (tpl.content ?? '').toLowerCase().includes(q),
    );
  }, [approved, search]);

  const selected = useMemo(() => templates.find((tpl) => tpl.id === value) ?? null, [templates, value]);
  const slots = templateVariableNames(selected);
  const blanks = slots.map((slot) => ({ slot, source: readBlank(variableMapping, slot, known) }));
  const openBlanks = blanks.filter((b) => !isBlankFilled(b.source)).length;

  const setBlank = (slot: string, source: BlankSource) => onMappingChange(writeBlank(variableMapping, slot, source));

  return (
    <div className="space-y-3">
      {/* ── Selected template, or the prompt to pick one ────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border p-3.5 text-start transition-colors',
          selected ? 'border-brand/40 bg-brand/5' : 'border-dashed border-line-strong bg-surface hover:border-brand/50',
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            selected ? 'bg-brand/15 text-brand' : 'bg-raised text-ink-4',
          )}
        >
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-semibold text-ink">
            {selected ? selected.name : t('template.choose')}
          </span>
          <span dir="auto" className="mt-0.5 block truncate text-xs text-ink-3">
            {selected
              ? open ? t('template.changeHint') : (selected.content ?? '').slice(0, 90)
              : t('template.chooseHint')}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
      </button>

      {/* ── The list ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('template.search')}
              className="field w-full ps-9 pe-3"
            />
          </div>

          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && (
              <div className="rounded-xl bg-raised p-4 text-center">
                <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
                <p className="mt-2 text-xs font-semibold text-ink-2">
                  {approved.length === 0 ? t('template.noneApproved') : t('template.noMatch')}
                </p>
                {approved.length === 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{t('template.noneApprovedHint')}</p>
                )}
              </div>
            )}

            {filtered.map((tpl) => {
              const isSelected = tpl.id === value;
              const tplSlots = templateVariableNames(tpl).length;
              const MediaIcon = tpl.mediaType === 'VIDEO' ? Video : tpl.mediaType === 'IMAGE' ? ImageIcon : null;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    onChange(tpl.id);
                    // A mapping from the previous template refers to blanks this
                    // one may not have; carrying it over would fill the wrong slots.
                    if (!isSelected) onMappingChange({});
                    setOpen(false);
                    setSearch('');
                  }}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors duration-fast',
                    isSelected
                      ? 'border-brand bg-brand/10 ring-1 ring-inset ring-brand'
                      : 'border-line bg-canvas hover:border-line-strong hover:bg-raised/60',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                      isSelected ? 'border-brand bg-brand' : 'border-line-strong',
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-brand-fg" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span dir="auto" className="min-w-0 truncate text-sm font-semibold text-ink">
                        {tpl.name}
                      </span>
                      {MediaIcon && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                          <MediaIcon className="h-3 w-3" />
                          {t(tpl.mediaType === 'VIDEO' ? 'form.typeVideo' : 'form.typeImage')}
                        </span>
                      )}
                      {tplSlots > 0 && (
                        <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          {t('template.blankCount', { count: tplSlots })}
                        </span>
                      )}
                    </span>
                    {/* No `block` here: it overrides line-clamp's display and shows the whole body. */}
                    <span dir="auto" className="mt-1 line-clamp-2 text-xs leading-5 text-ink-3">
                      {tpl.content}
                    </span>
                    <ButtonChips payload={tpl.payload} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Templates that exist but cannot be used, with the reason. */}
          {unapproved.length > 0 && (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-ink-3 hover:text-ink-2">
                {t('template.unavailableCount', { count: unapproved.length })}
              </summary>
              <div className="mt-2 space-y-1.5">
                {unapproved.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-2 px-1">
                    <span dir="auto" className="min-w-0 flex-1 truncate text-xs text-ink-3">{tpl.name}</span>
                    <ApprovalBadge template={tpl} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Blanks ──────────────────────────────────────────────────────────── */}
      {selected && blanks.length > 0 && !open && (
        <div
          className={cn(
            'rounded-xl border p-3.5 transition-colors',
            openBlanks ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-line',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-ink">{t('template.blanksTitle')}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{t('template.blanksHint')}</p>
            </div>
            {openBlanks > 0 && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                {t('template.blanksLeft', { count: openBlanks })}
              </span>
            )}
          </div>

          <div className="mt-3 space-y-3">
            {blanks.map(({ slot, source }) => {
              const filled = isBlankFilled(source);
              const selectValue = source.kind === 'field' ? source.field : source.kind === 'text' ? FIXED_TEXT : '';
              return (
                <div key={slot} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code
                      className={cn(
                        'shrink-0 rounded-lg px-2 py-1 font-mono text-[11px]',
                        filled ? 'bg-brand/10 text-brand' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {`{{${slot}}}`}
                    </code>
                    <select
                      value={selectValue}
                      aria-label={t('template.blankFor', { slot })}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === FIXED_TEXT) setBlank(slot, { kind: 'text', text: '' });
                        else if (next) setBlank(slot, { kind: 'field', field: next, fallback: '' });
                        else setBlank(slot, { kind: 'unset' });
                      }}
                      className={cn('field field-sm min-w-0 flex-1', !filled && 'ring-1 ring-amber-500/50')}
                    >
                      <option value="" disabled>{t('template.blankChoose')}</option>
                      <optgroup label={t('template.fromContact')}>
                        {fields.map((field) => (
                          <option key={field.value} value={field.value}>{field.label}</option>
                        ))}
                      </optgroup>
                      <option value={FIXED_TEXT}>{t('template.fixedText')}</option>
                    </select>
                  </div>

                  {source.kind === 'text' && (
                    <input
                      dir="auto"
                      autoFocus={!source.text}
                      value={source.text}
                      maxLength={200}
                      onChange={(e) => setBlank(slot, { kind: 'text', text: e.target.value })}
                      placeholder={t('template.fixedTextPlaceholder')}
                      className={cn('field field-sm w-full', !source.text.trim() && 'ring-1 ring-amber-500/50')}
                    />
                  )}

                  {source.kind === 'field' && (
                    <label className="flex items-center gap-2 ps-1 text-[11px] text-ink-3">
                      <span className="shrink-0">{t('template.fallbackLabel', { field: labelFor(source.field) })}</span>
                      <input
                        dir="auto"
                        value={source.fallback}
                        maxLength={100}
                        onChange={(e) => setBlank(slot, { ...source, fallback: e.target.value })}
                        placeholder={defaultFallback(source.field, selected.language)}
                        className="field field-sm min-w-0 flex-1"
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && !open && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onMappingChange({});
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-4 hover:text-rose-500"
        >
          <X className="h-3 w-3" /> {t('template.remove')}
        </button>
      )}
    </div>
  );
}
