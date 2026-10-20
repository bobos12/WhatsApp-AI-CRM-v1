'use client';

/**
 * Red strip on every page while Meta refuses to let the number send — almost
 * always billing (an unpaid balance, or the WhatsApp account still billed on a
 * partner's credit line). It says so in plain words and links straight to Meta's
 * billing page, so whoever sees it can pay instead of waiting on the admin.
 * Not dismissible: nothing sends until it's fixed. Clears itself once Meta
 * accepts sends again (the next successful send, or "Check again").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { billingAccountsUrl, type SendingStatus } from '@/lib/meta-billing';

const POLL_MS = 5 * 60 * 1000;

export default function SendingBlockedBanner() {
  const { t } = useTranslation('whatsapp');
  const [status, setStatus] = useState<SendingStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [stillBlocked, setStillBlocked] = useState(false);
  const lastLoad = useRef(0);

  const load = useCallback(async (fresh = false) => {
    lastLoad.current = Date.now();
    try {
      setStatus(await api.get<SendingStatus>(`/api/channel/sending-status${fresh ? '?fresh=1' : ''}`));
    } catch {
      /* advisory: a failed read never shows a false alarm */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => { if (Date.now() - lastLoad.current > 60_000) void load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  if (!status?.blocked) return null;

  const recheck = async () => {
    setChecking(true);
    setStillBlocked(false);
    await load(true);
    setChecking(false);
    setStillBlocked(true);
  };

  return (
    <div role="alert" className="enter shrink-0 border-b border-rose-500/30 bg-rose-500/[0.08] px-4 py-2.5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-rose-800 dark:text-rose-200">{t('sendingBlocked.title')}</p>
          <p className="text-xs leading-5 text-rose-800/90 dark:text-rose-300/90">
            {t(status.reason === 'PAYMENT_FAILED' ? 'sendingBlocked.bodyPayment' : 'sendingBlocked.body', { waba: status.wabaId ?? '' })}
          </p>
          {stillBlocked && !checking && (
            <p className="mt-0.5 text-2xs text-rose-700 dark:text-rose-300">{t('sendingBlocked.stillBlocked')}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={billingAccountsUrl(status.businessId)} target="_blank" rel="noopener noreferrer" className="btn btn-sm bg-rose-600 text-white hover:bg-rose-700">
            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
            {t('sendingBlocked.pay')}
          </a>
          <button type="button" onClick={recheck} disabled={checking} className="btn btn-secondary btn-sm">
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className={cn('h-3.5 w-3.5')} />}
            {t('sendingBlocked.recheck')}
          </button>
        </div>
      </div>
    </div>
  );
}
