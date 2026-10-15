'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CopyField, META_LINKS, Notice, errorText } from './shared';

/**
 * Move a number registered elsewhere (another provider's app) to this one.
 * This is the fix for "can read the number but every send is refused".
 */
export function RegisterNumberCard({ onDone }: { onDone: (canSend: boolean) => void }) {
  const { t } = useTranslation('whatsapp');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'done' | 'blocked' | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/api/channel/register', { pin });
      setResult(res?.canSend ? 'done' : 'blocked');
      onDone(Boolean(res?.canSend));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (result === 'done') return <Notice tone="success" title={t('setup.register.done')} />;

  return (
    <div className="enter rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold text-ink">{t('setup.register.title')}</p>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">{t('setup.register.body')}</p>
      <p className="mt-2 text-xs leading-5 text-ink-3">
        {t('setup.register.where')}{' '}
        <a href={META_LINKS.waManager} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
          {t('setup.register.openManager')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <label htmlFor="wa-pin" className="label">{t('setup.register.label')}</label>
          <input
            id="wa-pin"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            aria-invalid={Boolean(error)}
            aria-describedby="wa-pin-count"
            className="field text-center font-mono text-base tracking-[0.5em]"
          />
          <p id="wa-pin-count" className={cn('hint tabular-nums', pin.length === 6 && 'text-brand')}>
            {t('setup.register.digits', { n: pin.length })}
          </p>
        </div>
        <button type="submit" disabled={pin.length !== 6 || busy} className="btn btn-primary sm:mb-5">
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {busy ? t('setup.register.working') : t('setup.register.submit')}
        </button>
      </form>

      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      {result === 'blocked' && <div className="mt-3"><Notice tone="warn">{t('setup.register.stillBlocked')}</Notice></div>}
    </div>
  );
}

/** When Meta can't reach this server to verify the webhook, hand over the two values to paste. */
export function ManualWebhookCard({
  callbackUrl,
  verifyToken,
  onFixed,
}: {
  callbackUrl: string | null;
  verifyToken: string | null;
  onFixed: () => void;
}) {
  const { t } = useTranslation('whatsapp');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  const recheck = async () => {
    setBusy(true);
    setMissing(false);
    try {
      const report = await api.get('/api/channel/health?fresh=1');
      const hook = report?.checks?.find((c: { id: string }) => c.id === 'webhook');
      if (hook?.status === 'ok') onFixed();
      else setMissing(true);
    } catch {
      setMissing(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="enter rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold text-ink">{t('setup.webhook.title')}</p>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">{t('setup.webhook.body')}</p>
      <div className="mt-4 space-y-3">
        {callbackUrl && (
          <CopyField label={t('setup.webhook.callback')} value={callbackUrl} copyLabel={t('setup.credentials.guide.copy')} copiedLabel={t('setup.credentials.guide.copied')} />
        )}
        {verifyToken && (
          <CopyField label={t('setup.webhook.verifyToken')} value={verifyToken} copyLabel={t('setup.credentials.guide.copy')} copiedLabel={t('setup.credentials.guide.copied')} secret />
        )}
      </div>
      <a href={META_LINKS.apps} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        {t('setup.credentials.guide.openApps')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
      <div className="mt-4">
        <button type="button" onClick={recheck} disabled={busy} className="btn btn-secondary">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {busy ? t('setup.webhook.checking') : t('setup.webhook.recheck')}
        </button>
      </div>
      {missing && <div className="mt-3"><Notice tone="warn">{t('setup.webhook.stillMissing')}</Notice></div>}
    </div>
  );
}

/** Templates and campaigns stop when the WhatsApp account has no working card. */
export function PaymentCard() {
  const { t } = useTranslation('whatsapp');
  return (
    <Notice tone="warn" title={t('setup.payment.title')}>
      <p>{t('setup.payment.body')}</p>
      <a href={META_LINKS.billing} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-brand hover:underline">
        {t('setup.payment.open')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </Notice>
  );
}
