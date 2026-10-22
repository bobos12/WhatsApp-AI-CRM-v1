'use client';

import Link from 'next/link';
import { forwardRef } from 'react';
import { ArrowLeft, Search, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Page scaffolding ─────────────────────────────────────────────────────────
// Every screen opens the same way: a compact title row with the primary action
// at the end. Titles are 20px, not 30px — this is a tool people sit in all day,
// and every pixel spent on a heading is a row of data pushed below the fold.

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Renders a back link before the title (detail pages). */
  back?: { href: string; label: string };
  /** Small inline element after the title — a count, a status chip. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      {/* min width forces the actions onto their own line before the title gets squeezed */}
      <div className="min-w-[min(100%,20rem)] flex-1">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5 icon-mirror" aria-hidden="true" />
            {back.label}
          </Link>
        )}
        {/* Top-level pages: the phone app bar already shows the title, so it isn't repeated here. */}
        <div className={cn('flex min-w-0 flex-wrap items-center gap-2', !back && 'max-sm:hidden')}>
          <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          {meta}
        </div>
        {/* Phones keep the description to two lines so the content starts above the fold. */}
        {description && <p className="mt-1 line-clamp-2 max-w-2xl text-[13px] leading-5 text-ink-3 sm:line-clamp-none">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled panel. Use for content that is one unit; don't nest panels. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  open,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div';
  /** Heading sits above the box, on the page, instead of inside it. */
  open?: boolean;
}) {
  if (open) {
    return (
      <Tag className={cn('flex flex-col', className)}>
        {(title || actions) && (
          <div className="mb-3 flex items-end justify-between gap-3 px-0.5">
            <div className="min-w-0">
              {title && <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
              {description && <p className="mt-0.5 truncate text-xs text-ink-3">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
          </div>
        )}
        <div className={cn('panel min-h-0 flex-1 overflow-hidden', bodyClassName)}>{children}</div>
      </Tag>
    );
  }
  return (
    <Tag className={cn('panel flex flex-col', className)}>
      {(title || actions) && (
        <div className="panel-head">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {description && <p className="mt-0.5 truncate text-2xs text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      {Icon && (
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-raised text-ink-3">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      )}
      <div className="max-w-sm">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 text-xs leading-5 text-ink-3">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Search box with a leading icon and a clear button once there is a query. */
export const SearchField = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}>(function SearchField({ value, onChange, placeholder, className, inputClassName, autoFocus, onKeyDown }, ref) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn('field ps-8 pe-8 [&::-webkit-search-cancel-button]:hidden', inputClassName)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear"
          className="absolute end-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-raised hover:text-ink"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

/** Inline metric: label above, figure below. Used in strips, not as a card. */
export function Metric({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'brand' | 'warn' | 'danger';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="eyebrow truncate">{label}</p>
      <p className={cn(
        'mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink',
        tone === 'brand' && 'text-brand',
        tone === 'warn' && 'text-amber-600 dark:text-amber-400',
        tone === 'danger' && 'text-red-600 dark:text-red-400',
      )}>{value}</p>
      {sub && <p className="mt-1.5 truncate text-2xs text-ink-3">{sub}</p>}
    </div>
  );
}

/** Toggle switch — one implementation for the whole product. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-base ease-swift',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/25',
        sm ? 'h-4 w-7' : 'h-5 w-9',
        checked ? 'bg-brand' : 'bg-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-base ease-spring',
          sm ? 'h-3 w-3' : 'h-4 w-4',
          checked
            ? (sm ? 'translate-x-3.5 rtl:-translate-x-3.5' : 'translate-x-[18px] rtl:-translate-x-[18px]')
            : 'translate-x-0.5 rtl:-translate-x-0.5',
        )}
      />
    </button>
  );
}

/**
 * A row of page-level figures on an open band (hairlines, no box). The shared
 * answer to "show a few numbers above a list" — cards for four numbers are
 * four boxes to scan; a strip is one line to read.
 */
export function MetricStrip({
  items,
  className,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'brand' | 'warn' | 'danger'; live?: boolean }>;
  className?: string;
}) {
  const cols = items.length >= 5 ? 'sm:grid-cols-5' : items.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
  return (
    <div className={cn('grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-5', cols, className)}>
      {items.map((m, i) => (
        <div key={i} className="min-w-0">
          <p className="truncate text-2xs font-medium text-ink-3">{m.label}</p>
          <p className={cn(
            'mt-1 flex items-center gap-2 truncate text-2xl font-semibold tabular-nums tracking-[-0.02em] text-ink',
            m.tone === 'brand' && 'text-brand',
            m.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
            m.tone === 'danger' && 'text-red-600 dark:text-red-400',
          )}>
            {m.value}
            {m.live && <span className="live-dot bg-amber-500" aria-hidden="true" />}
          </p>
          {m.sub && <p className="mt-0.5 truncate text-2xs text-ink-4">{m.sub}</p>}
        </div>
      ))}
    </div>
  );
}
