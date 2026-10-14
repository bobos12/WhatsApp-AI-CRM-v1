'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { X, Plus, ChevronDown, Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/page';

// ─────────────────────────────────────────────────────────────────────────────
// Form primitives for the AI configuration screens. The bot's rules are strict
// and numerous; these exist so each one reads as a plain sentence with a
// control beside it, not as a technical field in a box inside a box.
// ─────────────────────────────────────────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return <Switch checked={checked} onChange={() => onChange()} disabled={disabled} />;
}

/** One setting: what it does on the start side, the control on the end side. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-ink-3">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A bordered list of SettingRows with hairlines between them. */
export function SettingsGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-line rounded-lg border border-line px-3.5', className)}>{children}</div>;
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-ink">{children}</label>
      {hint && <p className="mt-0.5 text-xs leading-5 text-ink-3">{hint}</p>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
  dir,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  return (
    <input
      type={type}
      value={value}
      dir={dir}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn('field', type === 'number' && 'tabular-nums', className)}
    />
  );
}

/**
 * Multi-line text. Long instructions show their size — characters and a rough
 * token count — because a prompt that silently grows past the model's budget is
 * one of the few ways to break the bot without touching a single toggle.
 */
export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  showCount,
  softLimit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  showCount?: boolean;
  /** Characters after which the counter turns amber. */
  softLimit?: number;
}) {
  const chars = value?.length ?? 0;
  const tokens = Math.ceil(chars / 4);
  const over = softLimit != null && chars > softLimit;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        dir="auto"
        placeholder={placeholder}
        className="field min-h-[76px] resize-y"
      />
      {showCount && chars > 0 && (
        <p className={cn('mt-1 text-end text-2xs tabular-nums', over ? 'text-amber-700 dark:text-amber-400' : 'text-ink-4')}>
          {chars.toLocaleString()} chars · ≈{tokens.toLocaleString()} tokens
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.1,
  display,
  icon,
  hint,
  minLabel,
  maxLabel,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  icon?: React.ReactNode;
  hint?: string;
  minLabel?: string;
  maxLabel?: string;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <label className="text-[13px] font-medium text-ink">{label}</label>
        </div>
        <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-xs tabular-nums text-ink-2 ring-1 ring-inset ring-line">
          {display ?? value}
        </span>
      </div>
      {hint && <p className="text-xs leading-5 text-ink-3">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="nx-range w-full"
        style={{ '--range-pct': `${pct}%` } as React.CSSProperties}
      />
      {(minLabel || maxLabel) && (
        <div className="flex justify-between text-2xs text-ink-4">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg max-w-full flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Add/remove an unlimited list of free-text strings (rules, topics, questions). */
export function TagListEditor({
  items,
  onChange,
  placeholder,
  multiline,
  numbered = true,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
  numbered?: boolean;
}) {
  const { t } = useTranslation('aiconfig');
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      {items.length > 0 ? (
        <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {items.map((item, i) => (
            <li key={i} className="group flex items-start gap-2.5 bg-surface px-3 py-2 transition-colors focus-within:bg-raised/50">
              {numbered && <span className="mt-[3px] w-4 shrink-0 text-end text-2xs font-medium tabular-nums text-ink-4">{i + 1}</span>}
              <textarea
                value={item}
                dir="auto"
                rows={multiline ? 2 : 1}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="mt-0.5 shrink-0 rounded p-0.5 text-ink-4 opacity-60 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-500/10"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-xs text-ink-3">
          {t('common.noneYet')}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="field flex-1"
        />
        <button type="button" onClick={add} disabled={!draft.trim()} className="btn btn-secondary">
          <Plus aria-hidden="true" /> {t('common.add')}
        </button>
      </div>
    </div>
  );
}

/** Key/value editor for custom variables. */
export function KeyValueEditor({
  items,
  onChange,
}: {
  items: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
}) {
  const { t } = useTranslation('aiconfig');
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={item.key}
            dir="ltr"
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...next[i], key: e.target.value };
              onChange(next);
            }}
            placeholder={t('common.variableName')}
            className="field w-40 font-mono text-xs"
          />
          <input
            value={item.value}
            dir="auto"
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...next[i], value: e.target.value };
              onChange(next);
            }}
            placeholder={t('common.value')}
            className="field flex-1"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="btn btn-ghost btn-icon btn-sm hover:text-red-600"
            aria-label="Remove"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { key: '', value: '' }])} className="btn btn-secondary btn-sm">
        <Plus aria-hidden="true" /> {t('common.addVariable')}
      </button>
    </div>
  );
}

/**
 * Toggle a set of values on/off from a known list of options (e.g. tags or
 * lifecycle stages). `selected` may contain values not present in `options`
 * (e.g. a tag that was deleted) — those still render so they can be cleared.
 */
export function ChipMultiSelect({
  options,
  selected,
  onChange,
  emptyLabel,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  const orphans = selected.filter((v) => !options.includes(v));
  const all = [...options, ...orphans];

  if (all.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-xs text-ink-3">
        {emptyLabel ?? 'No options available.'}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((v) => {
        const active = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => toggle(v)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
              active ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {active && <Check className="h-3 w-3" aria-hidden="true" />}
            {v}
          </button>
        );
      })}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-2">{children}</p>;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-4 rounded-lg border border-line bg-raised/40 p-4', className)}>
      {children}
    </div>
  );
}

/**
 * A topic of the configuration — one per thing a business owner cares about.
 * `emoji` is accepted for compatibility but no longer drawn; sections carry a
 * line icon so the page reads as one system rather than a sticker sheet.
 */
export function SectionCard({
  title,
  subtitle,
  badge,
  icon: Icon,
  children,
}: {
  emoji?: string;
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-2 ring-1 ring-inset ring-line">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{subtitle}</p>}
        </div>
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

/**
 * Collapsible "More options" for rarely-used or technical settings. Closed by
 * default so the page stays simple; nothing is lost — it is one click away.
 */
export function MoreOptions({
  label,
  children,
  defaultOpen = false,
}: {
  label?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation('aiconfig');
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <span>{label ?? t('common.moreOptions')}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-4 transition-transform duration-base ease-out', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-line p-3.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
