'use client';

/**
 * The WhatsApp connection as Settings shows it: which number is live, how Meta
 * rates it, a plain-language health check with each fix in place, and — for
 * managers — changing or disconnecting the number.
 *
 * First-time setup no longer happens here; SetupGate runs it full screen before
 * anyone reaches the CRM. This panel is for living with a connection.
 */

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { Loader2, Phone, Repeat, Unplug, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isManager } from '@/lib/roles';
import { formatPhone } from '@/lib/phone';
import { Modal } from '@/components/ui/modal';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';
import HealthChecklist from './setup/HealthChecklist';
import SetupWizard from './setup/SetupWizard';
import { Notice, errorText } from './setup/shared';

export default function WhatsAppLinkPanel(_props: { size?: 'sm' | 'md' }) {
  const { t } = useTranslation('whatsapp');
  const { data: session } = useSession();
  const canManage = isManager((session?.user as { role?: string } | undefined)?.role);
  const { status, connectedPhone, verifiedName, configured, health, refresh } = useWhatsAppConnection();

  const [changing, setChanging] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remounts the checklist so it re-runs after the number changes.
  const [healthKey, setHealthKey] = useState(0);

  if (!configured) {
    return canManage ? (
      <SetupWizard onFinish={() => void refresh()} />
    ) : (
      <Notice tone="info" title={t('waiting.title')}>{t('waiting.body')}</Notice>
    );
  }

  const live = status === 'connected';
  const quality = health?.qualityRating ?? 'UNKNOWN';
  const limit = health?.messagingLimit
    ? health.messagingLimit.replace('TIER_', '').replace('UNLIMITED', t('panel.unlimited'))
    : '—';

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await api.delete('/api/channel/cloud');
      setConfirmDisconnect(false);
      await refresh();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', live ? 'bg-brand/12 text-brand' : 'bg-red-500/10 text-red-500')}>
            <Phone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p dir="ltr" className="font-mono text-base font-semibold tabular-nums text-ink">{connectedPhone ? formatPhone(connectedPhone) : '—'}</p>
              <span className={cn('chip', live ? 'chip-brand' : 'chip-danger')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-brand' : 'bg-red-500')} aria-hidden="true" />
                {live ? t('panel.live') : t('panel.offline')}
              </span>
            </div>
            {verifiedName && <p className="mt-0.5 truncate text-[13px] text-ink-3">{t('panel.verifiedAs', { name: verifiedName })}</p>}
          </div>
          {canManage && (
            <div className="flex gap-2 sm:shrink-0">
              <button type="button" onClick={() => setChanging(true)} className="btn btn-secondary btn-sm flex-1 sm:flex-none">
                <Repeat aria-hidden="true" /> {t('panel.changeNumber')}
              </button>
              <button type="button" onClick={() => setConfirmDisconnect(true)} className="btn btn-ghost btn-sm text-ink-3 hover:text-red-600" aria-label={t('panel.disconnect')} title={t('panel.disconnect')}>
                <Unplug aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 border-t border-line">
          <div className="border-e border-line px-4 py-3 sm:px-5">
            <dt className="eyebrow">{t('panel.quality')}</dt>
            <dd className={cn(
              'mt-1 text-sm font-semibold',
              quality === 'GREEN' && 'text-brand',
              quality === 'YELLOW' && 'text-amber-500',
              quality === 'RED' && 'text-red-500',
              quality === 'UNKNOWN' && 'text-ink-3',
            )}>
              {quality === 'UNKNOWN' ? t('panel.notRated') : quality}
            </dd>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <dt className="eyebrow">{t('panel.limit')}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-ink">{limit}</dd>
          </div>
        </dl>
      </section>

      <HealthChecklist key={healthKey} canManage={canManage} onReconnect={() => setChanging(true)} />

      {/* Change number — the same wizard as first-time setup, with the saved
          token and secret kept unless the manager pastes new ones. */}
      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        aria-label={t('panel.changeNumber')}
        className="max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-surface p-5 shadow-pop sm:p-7"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{t('panel.changeNumber')}</h2>
          <button type="button" onClick={() => setChanging(false)} className="btn btn-ghost btn-icon btn-sm" aria-label={t('setup.close')}>
            <X aria-hidden="true" />
          </button>
        </div>
        <SetupWizard
          hasStoredCredentials
          onCancel={() => setChanging(false)}
          onFinish={async () => {
            setChanging(false);
            await refresh();
            setHealthKey((k) => k + 1);
          }}
        />
      </Modal>

      <Modal
        open={confirmDisconnect}
        onClose={() => !disconnecting && setConfirmDisconnect(false)}
        aria-label={t('panel.disconnectTitle')}
        className="w-[min(420px,calc(100vw-2rem))] rounded-2xl bg-surface p-6 shadow-pop"
      >
        <h2 className="text-base font-semibold text-ink">{t('panel.disconnectTitle')}</h2>
        <p className="mt-2 text-[13px] leading-6 text-ink-2">{t('panel.disconnectBody')}</p>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={disconnecting} className="btn btn-ghost">
            {t('panel.cancel')}
          </button>
          <button type="button" onClick={disconnect} disabled={disconnecting} className="btn btn-danger">
            {disconnecting && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t('panel.disconnectConfirm')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
