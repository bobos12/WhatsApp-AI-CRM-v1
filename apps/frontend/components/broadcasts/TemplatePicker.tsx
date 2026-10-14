'use client';

/**
 * Choose the approved template a campaign sends, and map its variables.
 *
 * This exists because a broadcast audience is by definition outside the 24-hour
 * customer service window, where WhatsApp accepts nothing but a template it has
 * approved. Free-form campaign text — which is what the composer's message box
 * writes — is refused per recipient with error 131047. So the template is not a
 * convenience here, it is the payload.
 *
 * Only APPROVED templates are selectable. Showing the others as pickable would
 * let someone build and schedule an entire campaign that the worker then parks
 * at TEMPLATE_NOT_APPROVED, hours later, with the audience already committed.
 * They are listed as disabled instead, with their real state, because "I made
 * that template, why isn't it here" is otherwise unanswerable.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, FileText, Search, X } from 'lucide-react';
import { ApprovalBadge, type MetaStatus } from '../templates/ApprovalStatus';

export interface PickableTemplate {
  id: string;
  name: string;
  content: string;
  language?: string;
  variables?: string[] | null;
  metaStatus?: MetaStatus;
  metaRejectedReason?: string | null;
}

/**
 * Contact fields the sender can substitute.
 *
 * These names must match `buildPersonalizationVars` in
 * broadcasts/personalization.ts EXACTLY. A token that is not in that map renders
 * as an empty string in the delivered message rather than erroring — so a
 * plausible-looking near-miss (`firstName` for `first_name`) ships a campaign
 * that greets every customer with a blank space, and nothing reports it.
 */
export const BUILT_IN_FIELD_KEYS = ['name', 'first_name', 'phone', 'email', 'company'] as const;

export function templateVariableNames(template: PickableTemplate | null | undefined): string[] {
  if (!template) return [];
  if (Array.isArray(template.variables) && template.variables.length) {
    return template.variables.filter((v): v is string => typeof v === 'string');
  }
  // Fall back to the body text so a template saved before `variables` was
  // populated still shows its placeholders rather than pretending it has none.
  const found = new Set<string>();
  for (const match of (template.content ?? '').matchAll(/\{\{(\w+)\}\}/g)) found.add(match[1]);
  return [...found];
}

/** Render the body with the chosen mapping shown as the field it will pull from. */
function previewWithMapping(
  content: string,
  mapping: Record<string, string>,
  fields: Array<{ value: string; label: string }>,
): string {
  return (content ?? '').replace(/\{\{(\w+)\}\}/g, (_all, name: string) => {
    const field = mapping[name] ?? name;
    const label = fields.find((f) => f.value === field)?.label ?? field;
    return `[${label}]`;
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

  // Custom fields are exposed by the sender under their bare key, so they are
  // valid mapping targets exactly like the built-ins. Built-ins win a name
  // collision server-side, so they are listed first to match that precedence.
  const fields = useMemo(
    () => [
      ...BUILT_IN_FIELD_KEYS.map((key) => ({
        value: key,
        label: t(`template.field${key.replace(/_(.)/g, (_m, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`),
      })),
      ...(customFields ?? [])
        .filter((cf) => !BUILT_IN_FIELD_KEYS.some((k) => k === cf.key))
        .map((cf) => ({ value: cf.key, label: cf.label })),
    ],
    [customFields, t],
  );

  const approved = useMemo(
    () => templates.filter((tpl) => tpl.metaStatus === 'APPROVED'),
    [templates],
  );
  const unapproved = useMemo(
    () => templates.filter((tpl) => tpl.metaStatus !== 'APPROVED'),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return approved;
    return approved.filter(
      (tpl) => tpl.name.toLowerCase().includes(q) || (tpl.content ?? '').toLowerCase().includes(q),
    );
  }, [approved, search]);

  const selected = useMemo(() => templates.find((tpl) => tpl.id === value) ?? null, [templates, value]);
  const variables = templateVariableNames(selected);

  return (
    <div className="space-y-3">
      {/* ── Selected template, or the prompt to pick one ────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
          selected
            ? 'border-brand/40 bg-brand/5'
            : 'border-dashed border-gray-300 bg-white hover:border-brand/50 dark:border-white/15 dark:bg-surface'
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            selected ? 'bg-brand/15 text-brand' : 'bg-gray-100 text-gray-400 dark:bg-white/5'
          }`}
        >
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {selected ? selected.name : t('template.choose')}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {selected
              ? previewWithMapping(selected.content, variableMapping, fields).slice(0, 90)
              : t('template.chooseHint')}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── The list ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-surface">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('template.search')}
              className="field w-full pl-9 pr-3"
            />
          </div>

          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="rounded-xl bg-gray-50 p-4 text-center dark:bg-white/5">
                <AlertTriangle className="mx-auto h-5 w-5 text-amber-500" />
                <p className="mt-2 text-xs font-semibold text-ink-2">
                  {approved.length === 0
                    ? t('template.noneApproved')
                    : t('template.noMatch')}
                </p>
                {approved.length === 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                    {t('template.noneApprovedHint')}
                  </p>
                )}
              </div>
            )}

            {filtered.map((tpl) => {
              const isSelected = tpl.id === value;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    onChange(tpl.id);
                    // A mapping from the previous template refers to variables
                    // this one may not have; carrying it over would silently fill
                    // the wrong slots.
                    onMappingChange({});
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand/10'
                      : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-white/10 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      isSelected ? 'border-brand bg-brand' : 'border-line-strong'
                    }`}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {tpl.name}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-ink-3">
                      {tpl.content}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Templates that exist but cannot be used, with the reason. */}
          {unapproved.length > 0 && (
            <details className="mt-3 border-t border-gray-100 pt-3 dark:border-white/5">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-500 hover:text-ink-2-3 dark:hover:text-white">
                {t('template.unavailableCount', { count: unapproved.length })}
              </summary>
              <div className="mt-2 space-y-1.5">
                {unapproved.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-2 px-1">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
                      {tpl.name}
                    </span>
                    <ApprovalBadge template={tpl} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Variable mapping ────────────────────────────────────────────────── */}
      {selected && variables.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-3.5 dark:border-white/10">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
            {t('template.personalisation')}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            {t('template.personalisationHint')}
          </p>
          <div className="mt-3 space-y-2">
            {variables.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <code className="shrink-0 rounded-lg bg-brand/10 px-2 py-1 font-mono text-[11px] text-brand">
                  {`{{${name}}}`}
                </code>
                <span className="text-gray-300 dark:text-white/20">→</span>
                <select
                  value={variableMapping[name] ?? name}
                  onChange={(e) => onMappingChange({ ...variableMapping, [name]: e.target.value })}
                  className="field field-sm min-w-0 flex-1"
                >
                  {/* A variable whose name already matches a token needs no
                      mapping, so that option is listed first and preselected. */}
                  {!fields.some((f) => f.value === name) && (
                    <option value={name}>{t('template.leaveEmpty')}</option>
                  )}
                  {fields.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl bg-gray-50 p-3 dark:bg-white/5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('template.preview')}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
              {previewWithMapping(selected.content, variableMapping, fields)}
            </p>
          </div>
        </div>
      )}

      {selected && (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onMappingChange({});
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-rose-500"
        >
          <X className="h-3 w-3" /> {t('template.remove')}
        </button>
      )}
    </div>
  );
}
