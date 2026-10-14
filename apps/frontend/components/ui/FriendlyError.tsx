'use client';

/**
 * FriendlyError — renders a raw error as a designed, actionable explanation card.
 *
 * Instead of dumping "WhatsApp is not connected" or "Recipient +9665… is not
 * available on WhatsApp" at the user, it shows: what happened, why, and the one
 * button that fixes it. Drop it anywhere a send/action can fail.
 *
 *   <FriendlyError error={err} onRetry={handleSend} />
 *
 * Pass a pre-classified object via `classified` when you've already run the
 * classifier (e.g. to render a grouped breakdown).
 */

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WifiOff, PhoneOff, MessageSquareDashed, ShieldAlert, Users, Timer,
  Lock, ImageOff, CloudOff, AlertTriangle, ChevronRight, RotateCw, ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { classifyError, type ClassifiedError, type FriendlyCode, type FriendlySeverity } from '../../lib/friendly-error';

// ── Per-cause presentation (icon + optional fix action) ───────────────────────
const ICONS: Record<FriendlyCode, typeof WifiOff> = {
  whatsappDisconnected: WifiOff,
  notOnWhatsapp:        PhoneOff,
  invalidPhone:         PhoneOff,
  emptyMessage:         MessageSquareDashed,
  warmupLimit:          ShieldAlert,
  tooManyRecipients:    Users,
  rateLimited:          Timer,
  mediaFailed:          ImageOff,
  auth:                 Lock,
  network:              CloudOff,
  generic:              AlertTriangle,
};

const ACTIONS: Partial<Record<FriendlyCode, string>> = {
  whatsappDisconnected: '/settings?section=whatsapp',
  warmupLimit:          '/settings?section=whatsapp',
  tooManyRecipients:    '/broadcasts',
  auth:                 '/login',
};

// ── Severity → colour system (light + dark) ───────────────────────────────────
const SEVERITY: Record<FriendlySeverity, {
  panel: string; icon: string; iconWrap: string; title: string; body: string; action: string;
}> = {
  error: {
    panel:    'border-red-300/70 bg-red-50 dark:border-red-500/25 dark:bg-red-500/[0.08]',
    iconWrap: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    icon:     '',
    title:    'text-red-900 dark:text-red-200',
    body:     'text-red-700/90 dark:text-red-300/80',
    action:   'bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400',
  },
  warning: {
    panel:    'border-amber-300/70 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/[0.08]',
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    icon:     '',
    title:    'text-amber-900 dark:text-amber-200',
    body:     'text-amber-800/90 dark:text-amber-300/80',
    action:   'bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400',
  },
  info: {
    panel:    'border-blue-300/70 bg-blue-50 dark:border-blue-500/25 dark:bg-blue-500/[0.08]',
    iconWrap: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    icon:     '',
    title:    'text-blue-900 dark:text-blue-200',
    body:     'text-blue-800/90 dark:text-blue-300/80',
    action:   'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400',
  },
};

interface FriendlyErrorProps {
  /** A raw thrown error / string. Ignored if `classified` is provided. */
  error?: unknown;
  /** A pre-classified error (from classifyError / groupErrors). */
  classified?: ClassifiedError;
  /** Show a Retry button that calls this. */
  onRetry?: () => void;
  /** Hide the primary fix action link (e.g. when already on that page). */
  hideAction?: boolean;
  /** Tighter paddings for use inside dialogs. */
  compact?: boolean;
  /** Show a "×N" chip next to the title (used for grouped failure breakdowns). */
  count?: number;
  className?: string;
}

/** Resolve the localized body, falling back to a phone/limit-free variant. */
function resolveBody(
  t: (k: string, o?: any) => string,
  code: FriendlyCode,
  values: Record<string, string | number>,
): string {
  const base = `friendly.${code}`;
  if (code === 'notOnWhatsapp' && !values.phone) return t(`${base}.bodyNoPhone`);
  if (code === 'warmupLimit' && values.limit === undefined) return t(`${base}.bodyGeneric`);
  if (code === 'tooManyRecipients' && values.max === undefined) return t(`${base}.bodyGeneric`);
  return t(`${base}.body`, values);
}

export default function FriendlyError({
  error, classified, onRetry, hideAction, compact, count, className,
}: FriendlyErrorProps) {
  const { t } = useTranslation('errors');
  const [showDetails, setShowDetails] = useState(false);

  const result = classified ?? (error !== undefined ? classifyError(error) : null);
  if (!result) return null;

  const { code, severity, values, raw } = result;
  const Icon = ICONS[code];
  const s = SEVERITY[severity];
  const actionHref = !hideAction ? ACTIONS[code] : undefined;
  const actionLabel = t(`friendly.${code}.action`, { defaultValue: '' });
  const title = t(`friendly.${code}.title`);
  const body = resolveBody(t, code, values);
  // Only offer the raw technical detail for the catch-all, where the friendly
  // copy can't say anything specific and the underlying message may help.
  const canShowDetails = code === 'generic' && !!raw && raw.toLowerCase() !== title.toLowerCase();

  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border',
        compact ? 'p-3' : 'p-4',
        s.panel,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex shrink-0 items-center justify-center rounded-xl', compact ? 'h-8 w-8' : 'h-10 w-10', s.iconWrap)}>
          <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn('flex items-center gap-2 font-semibold leading-snug', compact ? 'text-[13px]' : 'text-sm', s.title)}>
            <span className="min-w-0 truncate">{title}</span>
            {typeof count === 'number' && count > 0 && (
              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums', s.iconWrap)}>
                ×{count}
              </span>
            )}
          </p>
          <p className={cn('mt-0.5 leading-relaxed', compact ? 'text-xs' : 'text-[13px]', s.body)}>
            {body}
          </p>

          {/* Actions row */}
          {(actionHref && actionLabel) || onRetry ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {actionHref && actionLabel && (
                <Link
                  href={actionHref}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95',
                    s.action,
                  )}
                >
                  {actionLabel}
                  <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              )}
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95',
                    'border-black/10 bg-white/60 text-gray-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10',
                  )}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('friendly.retry', { defaultValue: 'Try again' })}
                </button>
              )}
            </div>
          ) : null}

          {/* Technical details disclosure (generic only) */}
          {canShowDetails && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className={cn('inline-flex items-center gap-1 text-[11px] font-medium opacity-70 hover:opacity-100', s.body)}
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', showDetails && 'rotate-180')} aria-hidden="true" />
                {t('friendly.detailsLabel', { defaultValue: 'Technical details' })}
              </button>
              {showDetails && (
                <pre className={cn('mt-1.5 max-h-32 overflow-auto rounded-lg bg-black/5 p-2 text-[11px] leading-relaxed dark:bg-black/30', s.body)}>
                  {raw}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
