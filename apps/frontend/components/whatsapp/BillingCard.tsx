'use client';

/**
 * WhatsApp billing, one card: is Meta letting us send, which account to pay,
 * and buttons straight to Meta's billing pages. The WhatsApp account ID is the
 * row to look for on Meta's list, so it's shown big with a copy button.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCircle2, Copy, CreditCard, ExternalLink, Loader2, ReceiptText, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { billingAccountsUrl, paymentMethodsUrl, type SendingStatus } from '@/lib/meta-billing';

export default function BillingCard() {
  const { t } = useTranslation('whatsapp');
  const [status, setStatus] = useState<SendingStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (fresh = false) => {
    try {
      setStatus(await api.get<SendingStatus>(`/api/channel/sending-status${fresh ? '?fresh=1' : ''}`));
    } catch { /* the card stays in its last state */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!status?.connected) return null;
  const blocked = status.blocked;

  const copy = async () => {
    if (!status.wabaId) return;
    try {
      await navigator.clipboard.writeText(status.wabaId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the ID is still visible to copy by hand */ }
  };

  const recheck = async () => {
    setChecking(true);
    await load(true);
    setChecking(false);
  };

  return (
    <section className="panel overflow-hidden" aria-labelledby="billing-title">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <ReceiptText className="h-4 w-4 text-ink-4" aria-hidden="true" />
        <h2 id="billing-title" className="flex-1 text-[14px] font-semibold text-ink">{t('billing.title')}</h2>
        <span className={cn('chip', blocked ? 'chip-danger' : 'chip-brand')}>
          {blocked ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
          {blocked ? t('billing.blocked') : t('billing.ok')}
        </span>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <p className={cn('text-[13px] leading-6', blocked ? 'font-medium text-rose-700 dark:text-rose-300' : 'text-ink-2')}>
          {blocked ? t('billing.blockedBody') : t('billing.okBody')}
        </p>

        {/* The row to find on Meta's list */}
        {status.wabaId && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-2xs text-ink-3">{t('billing.accountId')}</p>
              <p dir="ltr" className="text-start font-mono text-[15px] font-semibold tabular-nums text-ink">{status.wabaId}</p>
            </div>
            <button type="button" onClick={copy} className="btn btn-ghost btn-sm shrink-0">
              {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('billing.copied') : t('billing.copy')}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={billingAccountsUrl(status.businessId)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('btn flex-1 justify-center', blocked ? 'bg-rose-600 text-white hover:bg-rose-700' : 'btn-primary')}
          >
            <CreditCard aria-hidden="true" /> {t('billing.payNow')} <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </a>
          <a href={paymentMethodsUrl(status.businessId)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1 justify-center">
            {t('billing.cards')} <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </a>
          <button type="button" onClick={recheck} disabled={checking} className="btn btn-ghost justify-center">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('billing.recheck')}
          </button>
        </div>

        <ol className="space-y-1.5 border-t border-line pt-3.5 text-xs leading-5 text-ink-3">
          {(['step1', 'step2', 'step3'] as const).map((k, i) => (
            <li key={k} className="flex gap-2">
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-raised text-2xs font-semibold tabular-nums text-ink-2 ring-1 ring-inset ring-line">{i + 1}</span>
              <span>{t(`billing.${k}`, { waba: status.wabaId ?? '' })}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
