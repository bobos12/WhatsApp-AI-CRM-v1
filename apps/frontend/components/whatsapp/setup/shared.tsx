'use client';

import { useState } from 'react';
import type { TFunction } from 'i18next';
import { AlertTriangle, Check, CheckCircle2, CircleDashed, Copy, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Meta screens the setup sends people to. Kept together so a moved page is one edit. */
export const META_LINKS = {
  systemUsers: 'https://business.facebook.com/settings/system-users',
  apps: 'https://developers.facebook.com/apps',
  waManager: 'https://business.facebook.com/wa/manage/phone-numbers/',
  billing: 'https://business.facebook.com/billing_hub/accounts',
};

export const TOKEN_PERMISSIONS = [
  'whatsapp_business_messaging',
  'whatsapp_business_management',
  'business_management',
];

/**
 * The server tags every setup failure with a stable code. Showing its English
 * sentence to an Arabic-speaking admin is what this avoids: the code picks the
 * translated text, and the server's wording is only the fallback.
 */
export function errorText(t: TFunction, err: unknown): string {
  const e = err as { code?: string; message?: string; status?: number } | null;
  if (e?.code && t(`errors.${e.code}`, { defaultValue: '' })) return t(`errors.${e.code}`);
  if (e instanceof TypeError || e?.message === 'Failed to fetch') return t('errors.network');
  return e?.message || t('errors.generic');
}

export type RowStatus = 'ok' | 'warn' | 'fail' | 'skip' | 'pending' | 'running';

export function StatusIcon({ status, className }: { status: RowStatus; className?: string }) {
  const base = cn('h-[18px] w-[18px] shrink-0', className);
  switch (status) {
    case 'ok':
      return <CheckCircle2 className={cn(base, 'text-brand pop-enter')} aria-hidden="true" />;
    case 'warn':
      return <AlertTriangle className={cn(base, 'text-amber-500 pop-enter')} aria-hidden="true" />;
    case 'fail':
      return <XCircle className={cn(base, 'text-red-500 pop-enter')} aria-hidden="true" />;
    case 'running':
      return <Loader2 className={cn(base, 'animate-spin text-ink-3')} aria-hidden="true" />;
    default:
      return <CircleDashed className={cn(base, 'text-ink-4')} aria-hidden="true" />;
  }
}

export function CopyField({
  label,
  value,
  copyLabel,
  copiedLabel,
  secret,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the value is visible and selectable */
    }
  };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised ps-3 pe-1">
        <code
          dir="ltr"
          className={cn('min-w-0 flex-1 truncate py-2 font-mono text-xs text-ink-2', secret && 'select-all')}
        >
          {value}
        </code>
        <button type="button" onClick={copy} className="btn btn-ghost btn-sm" aria-live="polite">
          {copied ? <Check className="text-brand" aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  );
}

/** A callout that explains a problem and carries its fix. */
export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  children?: React.ReactNode;
}) {
  const styles = {
    info: 'border-blue-500/20 bg-blue-500/[0.06]',
    warn: 'border-amber-500/25 bg-amber-500/[0.07]',
    error: 'border-red-500/25 bg-red-500/[0.06]',
    success: 'border-brand/25 bg-brand/[0.07]',
  }[tone];
  const icon = {
    info: <AlertTriangle className="h-4 w-4 text-blue-500" aria-hidden="true" />,
    warn: <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />,
    error: <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />,
    success: <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden="true" />,
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('enter flex gap-3 rounded-xl border p-3.5', styles)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink-2">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={cn(title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  );
}
