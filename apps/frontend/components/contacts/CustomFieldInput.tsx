'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { CustomFieldDefinition } from '../../lib/custom-fields';

/**
 * Renders one custom field as the input its type deserves. There is a branch per
 * `CustomFieldType` and no generic fallback: adding a type to the enum should
 * fail the build here rather than silently degrade to a text box.
 */

const inputCls =
  'block w-full rounded-xl border border-line bg-white dark:bg-raised px-3 py-2 text-sm ' +
  'text-ink placeholder:text-ink-4 outline-none transition ' +
  'focus:border-brand focus:ring-1 focus:ring-brand/30';

interface Props {
  definition: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string | null;
  /** Compact styling for dense surfaces like the import preview. */
  dense?: boolean;
}

function MultiSelect({ definition, value, onChange }: Omit<Props, 'error' | 'dense'>) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const options = definition.options ?? [];

  const toggle = (optionValue: string) =>
    onChange(
      selected.includes(optionValue)
        ? selected.filter((entry) => entry !== optionValue)
        : [...selected, optionValue],
    );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(inputCls, 'flex items-center justify-between gap-2 text-left')}
      >
        <span className={cn('truncate', !selected.length && 'text-ink-4')}>
          {selected.length
            ? options.filter((option) => selected.includes(option.value)).map((option) => option.label).join(', ')
            : definition.placeholder || 'Select…'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          {/* Click-away layer, so the popover closes without a global listener. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-3">No options defined.</p>
            )}
            {options.map((option) => {
              const active = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggle(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                    active
                      ? 'bg-brand/10 text-brand'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-raised',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      active ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 dark:border-white/25',
                    )}
                  >
                    {active && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {option.color && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
                  )}
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function FieldControl({ definition, value, onChange }: Omit<Props, 'error' | 'dense'>) {
  const placeholder = definition.placeholder ?? '';

  switch (definition.type) {
    case 'NOTES':
      return (
        <textarea
          rows={3}
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputCls, 'resize-y')}
        />
      );

    case 'CHECKBOX':
      return (
        <label className="inline-flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
          />
          <span className="text-sm text-gray-700 dark:text-gray-200">
            {definition.placeholder || 'Yes'}
          </span>
        </label>
      );

    case 'SELECT':
      return (
        <select
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        >
          <option value="">{placeholder || 'Select…'}</option>
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'MULTI_SELECT':
      return <MultiSelect definition={definition} value={value} onChange={onChange} />;

    case 'DATE':
      return (
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputCls, '[color-scheme:light] dark:[color-scheme:dark]')}
        />
      );

    case 'NUMBER':
      return (
        <input
          type="number"
          inputMode="decimal"
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        />
      );

    case 'CURRENCY':
      return (
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={String(value ?? '')}
            placeholder={placeholder || '0.00'}
            onChange={(event) => onChange(event.target.value)}
            className={cn(inputCls, definition.currency && 'pe-14')}
          />
          {definition.currency && (
            <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-4">
              {definition.currency}
            </span>
          )}
        </div>
      );

    case 'EMAIL':
      return (
        <input
          type="email"
          dir="ltr"
          value={String(value ?? '')}
          placeholder={placeholder || 'name@example.com'}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        />
      );

    case 'PHONE':
      return (
        <input
          type="tel"
          dir="ltr"
          value={String(value ?? '')}
          placeholder={placeholder || '+20 100 000 0000'}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        />
      );

    case 'URL':
      return (
        <input
          type="url"
          dir="ltr"
          value={String(value ?? '')}
          placeholder={placeholder || 'https://example.com'}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        />
      );

    case 'TEXT':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
        />
      );

    default: {
      // A new CustomFieldType must add a branch above; this makes that a type error.
      const unreachable: never = definition.type;
      return <p className="text-xs text-red-400">Unsupported field type: {String(unreachable)}</p>;
    }
  }
}

export default function CustomFieldInput({ definition, value, onChange, error, dense }: Props) {
  return (
    <div className={dense ? '' : 'space-y-1.5'}>
      <label className="block text-sm font-medium text-ink-2">
        {definition.label}
        {definition.required && <span className="ms-1 text-red-400">*</span>}
      </label>

      <FieldControl definition={definition} value={value} onChange={onChange} />

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : definition.helpText ? (
        <p className="text-xs text-ink-3">{definition.helpText}</p>
      ) : null}
    </div>
  );
}
