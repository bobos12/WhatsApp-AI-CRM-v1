'use client';

/**
 * Condition builder for a contact audience — "notes contains balcony", "tower is
 * A or B", "budget greater than 500000".
 *
 * It is shared by the contacts list and the broadcast audience step, which is
 * the point: an audience is picked with exactly the vocabulary the contacts page
 * filters with. It never evaluates a condition itself — it emits an
 * `AudienceFilter` and lets the server decide who matches (see lib/audience-filter.ts).
 *
 * The broadcast form sits on a hard-coded dark card while the contacts page
 * follows the theme, so every surface class comes from `TONES` rather than being
 * written inline.
 */

import { useId, useMemo } from 'react';
import { Plus, X, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useCustomFields } from '../../hooks/useCustomFields';
import { useFieldValues } from '../../hooks/useFieldValues';
import {
  activeConditionCount,
  filterableFields,
  operatorsFor,
  valueInputFor,
  type AudienceCondition,
  type AudienceFilter,
  type AudienceOperator,
  type FilterableField,
} from '../../lib/audience-filter';

type Tone = 'auto' | 'dark';

const TONES: Record<Tone, { panel: string; input: string; label: string; muted: string; ghost: string }> = {
  auto: {
    panel: 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A]',
    input:
      'border-gray-300 dark:border-white/10 bg-white dark:bg-[#202C33] text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#8696A0]',
    label: 'text-gray-700 dark:text-gray-200',
    muted: 'text-gray-500 dark:text-[#8696A0]',
    ghost:
      'border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/10',
  },
  dark: {
    panel: 'border-white/10 bg-[#0B141A]',
    input: 'border-white/10 bg-[#202C33] text-white placeholder:text-[#8696A0]',
    label: 'text-gray-200',
    muted: 'text-[#8696A0]',
    ghost: 'border-white/10 bg-white/5 text-[#8696A0] hover:bg-white/10',
  },
};

interface AudienceFilterBuilderProps {
  value: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  tone?: Tone;
  /** Rendered under the header — e.g. the broadcast form's "N contacts match". */
  summary?: React.ReactNode;
}

export default function AudienceFilterBuilder({
  value,
  onChange,
  tone = 'auto',
  summary,
}: AudienceFilterBuilderProps) {
  const { t } = useTranslation('contacts');
  const { definitions } = useCustomFields();
  const fieldValues = useFieldValues();
  const styles = TONES[tone];

  const fields = useMemo(() => filterableFields(definitions), [definitions]);
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const conditions = value.conditions ?? [];
  const activeCount = activeConditionCount(value, fields);

  /**
   * A field the user can pick *from* rather than type into. A plain-text field
   * like "tower" declares no options, but the data does: whatever towers exist
   * become the choices. A field with real options (a SELECT) keeps its own —
   * they carry labels and colours the raw values don't.
   */
  const withChoices = (field: FilterableField | undefined): FilterableField | undefined => {
    if (!field) return undefined;
    if (field.options?.length) return field;

    const observed = fieldValues[field.key];
    if (!observed?.length) return field;
    return { ...field, options: observed.map((entry) => ({ value: entry, label: entry })) };
  };

  const patch = (index: number, next: Partial<AudienceCondition>) => {
    onChange({
      ...value,
      conditions: conditions.map((condition, i) => (i === index ? { ...condition, ...next } : condition)),
    });
  };

  /** Changing the field re-picks an operator the new type actually admits. */
  const changeField = (index: number, key: string) => {
    const field = fieldByKey.get(key);
    const [firstOperator] = operatorsFor(field);
    patch(index, { field: key, operator: firstOperator, value: undefined });
  };

  /** Changing the operator drops a value the new input can no longer hold. */
  const changeOperator = (index: number, operator: AudienceOperator) => {
    const field = withChoices(fieldByKey.get(conditions[index]?.field ?? ''));
    const kind = valueInputFor(field, operator);
    const previous = valueInputFor(field, conditions[index]?.operator ?? 'equals');
    patch(index, { operator, ...(kind === previous ? {} : { value: undefined }) });
  };

  const addCondition = () => {
    const field = fields[0];
    onChange({
      ...value,
      match: value.match ?? 'all',
      conditions: [
        ...conditions,
        { field: field?.key ?? 'name', operator: operatorsFor(field)[0], value: undefined },
      ],
    });
  };

  const removeCondition = (index: number) => {
    onChange({ ...value, conditions: conditions.filter((_, i) => i !== index) });
  };

  const clearAll = () => onChange({ match: 'all', conditions: [] });

  return (
    <div className={cn('rounded-xl border p-3 sm:p-4', styles.panel)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', styles.label)}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('filters.advanced.title', { defaultValue: 'Advanced filters' })}
          {activeCount > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#25D366] px-1 text-[10px] font-bold text-slate-950">
              {activeCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {summary}
          {conditions.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className={cn('inline-flex items-center gap-1 text-[11px] transition hover:text-red-400', styles.muted)}
            >
              <Trash2 className="h-3 w-3" />
              {t('filters.advanced.clear', { defaultValue: 'Clear' })}
            </button>
          )}
        </div>
      </div>

      {/* Match mode — only meaningful once two conditions can disagree. */}
      {conditions.length > 1 && (
        <div className="mb-3 flex items-center gap-2">
          <span className={cn('text-[11px]', styles.muted)}>
            {t('filters.advanced.matchLabel', { defaultValue: 'Match' })}
          </span>
          <div className={cn('inline-flex rounded-lg border p-0.5', styles.ghost)}>
            {(['all', 'any'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...value, match: mode })}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                  (value.match ?? 'all') === mode
                    ? 'bg-[#25D366] text-slate-950'
                    : 'text-inherit hover:opacity-80',
                )}
              >
                {mode === 'all'
                  ? t('filters.advanced.matchAll', { defaultValue: 'All conditions' })
                  : t('filters.advanced.matchAny', { defaultValue: 'Any condition' })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {conditions.map((condition, index) => {
          const declared = fieldByKey.get(condition.field);
          // Operators come from the declared type; the *value* input may still be
          // a picker, because the data supplies choices the type never declared.
          const operators = operatorsFor(declared);
          const field = withChoices(declared);
          const kind = valueInputFor(field, condition.operator);

          return (
            <div
              key={index}
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <select
                value={condition.field}
                onChange={(event) => changeField(index, event.target.value)}
                className={cn(
                  'h-9 min-w-0 flex-1 rounded-lg border px-2 text-xs outline-none transition focus:border-[#25D366]/50 sm:max-w-[180px]',
                  styles.input,
                )}
              >
                <optgroup label={t('filters.advanced.builtInGroup', { defaultValue: 'Contact fields' })}>
                  {fields.filter((entry) => !entry.custom).map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {builtInLabel(t, entry)}
                    </option>
                  ))}
                </optgroup>
                {fields.some((entry) => entry.custom) && (
                  <optgroup label={t('filters.advanced.customGroup', { defaultValue: 'Custom fields' })}>
                    {fields.filter((entry) => entry.custom).map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              <select
                value={condition.operator}
                onChange={(event) => changeOperator(index, event.target.value as AudienceOperator)}
                className={cn(
                  'h-9 min-w-0 rounded-lg border px-2 text-xs outline-none transition focus:border-[#25D366]/50 sm:w-[140px]',
                  styles.input,
                )}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {t(`filters.advanced.operators.${operator}`, { defaultValue: operator.replace(/_/g, ' ') })}
                  </option>
                ))}
              </select>

              {/* Value + remove share a row on mobile. Stacked, the 36px square
                  button sat alone on its own line under a full-width input,
                  which read as a fourth field rather than a delete. */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ValueInput
                    field={field}
                    kind={kind}
                    value={condition.value}
                    onChange={(next) => patch(index, { value: next })}
                    styles={styles}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  aria-label={t('filters.advanced.remove', { defaultValue: 'Remove condition' })}
                  className={cn(
                    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition hover:text-red-400',
                    styles.ghost,
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCondition}
        className={cn(
          'mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-medium transition hover:border-[#25D366]/40 hover:text-[#25D366]',
          styles.ghost,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        {conditions.length === 0
          ? t('filters.advanced.addFirst', { defaultValue: 'Add a filter' })
          : t('filters.advanced.add', { defaultValue: 'Add condition' })}
      </button>

      {conditions.length === 0 && (
        <p className={cn('mt-2 text-[11px]', styles.muted)}>
          {t('filters.advanced.hint', {
            defaultValue: 'Filter by notes, company, status, created date — or any custom field you have defined.',
          })}
        </p>
      )}
    </div>
  );
}

/** Built-in field names are translated; custom-field labels are the user's own words. */
function builtInLabel(t: (key: string, opts: { defaultValue: string }) => string, field: FilterableField) {
  return t(`filters.advanced.fields.${field.key}`, { defaultValue: field.label });
}

function ValueInput({
  field,
  kind,
  value,
  onChange,
  styles,
}: {
  field: FilterableField | undefined;
  kind: ReturnType<typeof valueInputFor>;
  value: unknown;
  onChange: (value: unknown) => void;
  styles: (typeof TONES)[Tone];
}) {
  const { t } = useTranslation('contacts');
  const listId = useId();
  const inputClass = cn(
    'h-9 w-full rounded-lg border px-2 text-xs outline-none transition focus:border-[#25D366]/50',
    styles.input,
  );

  if (kind === 'none') {
    return (
      <p className={cn('px-1 text-[11px] italic', styles.muted)}>
        {t('filters.advanced.noValueNeeded', { defaultValue: 'No value needed' })}
      </p>
    );
  }

  if (kind === 'boolean') {
    return (
      <select
        value={value === true || value === 'true' ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
        className={inputClass}
      >
        <option value="true">{t('filters.advanced.checked', { defaultValue: 'Checked' })}</option>
        <option value="false">{t('filters.advanced.unchecked', { defaultValue: 'Unchecked' })}</option>
      </select>
    );
  }

  if (kind === 'option') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">{t('filters.advanced.choose', { defaultValue: 'Choose…' })}</option>
        {(field?.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  // `in` over a choice field: a checkbox row, because "tower is A or B" is the
  // single most common audience a business asks for and a multi-<select> hides it.
  if (kind === 'options') {
    const selected = new Set((Array.isArray(value) ? value : []).map(String));
    const toggle = (option: string) => {
      const next = new Set(selected);
      next.has(option) ? next.delete(option) : next.add(option);
      onChange(Array.from(next));
    };

    return (
      <div className="flex flex-wrap gap-1.5">
        {(field?.options ?? []).map((option) => {
          const active = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition',
                active
                  ? 'border-[#25D366] bg-[#25D366]/15 text-[#25D366]'
                  : styles.ghost,
              )}
              style={active && option.color ? { borderColor: option.color, color: option.color } : undefined}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Free text, but still suggesting the values that exist — so "company is" can be
  // picked from the real list while an unlisted value stays typeable.
  const suggestions = kind === 'text' ? (field?.options ?? []) : [];

  return (
    <>
      <input
        type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
        value={value == null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('filters.advanced.valuePlaceholder', { defaultValue: 'Value' })}
        list={suggestions.length ? listId : undefined}
        className={inputClass}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option.value} value={option.value} />
          ))}
        </datalist>
      )}
    </>
  );
}
