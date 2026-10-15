'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { META_LINKS, Notice, StatusIcon, errorText } from './shared';
import { ManualWebhookCard, RegisterNumberCard } from './FixCards';

interface Check {
  id: 'token' | 'number' | 'account' | 'webhook' | 'sending';
  status: 'ok' | 'warn' | 'fail' | 'skip';
  code: string;
  detail?: string;
  fix?: 'reconnect' | 'register' | 'webhook' | 'billing' | 'whatsapp_manager';
}

interface Report {
  checks: Check[];
  ready: boolean;
  checkedAt: string;
}

/**
 * The connection explained row by row, each problem next to its fix. Employees
 * see the same rows without the actions — knowing *why* messages aren't
 * arriving is useful even to someone who can't change the setup.
 */
export default function HealthChecklist({
  canManage,
  onReconnect,
}: {
  canManage: boolean;
  onReconnect: () => void;
}) {
  const { t, i18n } = useTranslation('whatsapp');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFix, setOpenFix] = useState<'register' | 'webhook' | null>(null);
  const [manualWebhook, setManualWebhook] = useState<{ callbackUrl: string | null; verifyToken: string | null } | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixedNote, setFixedNote] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.get(`/api/channel/health${fresh ? '?fresh=1' : ''}`));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const autoFixWebhook = async () => {
    setFixing(true);
    setFixedNote(null);
    try {
      const res = await api.post('/api/channel/webhook', {});
      if (res?.configured) {
        setFixedNote(t('health.webhookFixed'));
        setOpenFix(null);
        await load(true);
      } else {
        setManualWebhook(res?.manualWebhook ?? null);
        setOpenFix('webhook');
      }
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setFixing(false);
    }
  };

  const runFix = (fix: NonNullable<Check['fix']>) => {
    if (fix === 'reconnect') return onReconnect();
    if (fix === 'register') return setOpenFix((v) => (v === 'register' ? null : 'register'));
    if (fix === 'webhook') return void autoFixWebhook();
  };

  const problems = report?.checks.filter((c) => c.status === 'fail' || c.status === 'warn').length ?? 0;
  const checkedAt = report
    ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(report.checkedAt))
    : null;

  return (
    <section className="panel" aria-labelledby="wa-health-title">
      <div className="panel-head">
        <div className="min-w-0">
          <h3 id="wa-health-title" className="panel-title">{t('health.title')}</h3>
          {report && (
            <p className={cn('mt-0.5 text-2xs', problems ? 'text-amber-600 dark:text-amber-400' : 'text-brand')}>
              {problems ? t('health.needsAttention') : t('health.allGood')}
              {checkedAt && <span className="text-ink-4"> · {t('health.checkedAt', { time: checkedAt })}</span>}
            </p>
          )}
        </div>
        <button type="button" onClick={() => load(true)} disabled={loading} className="btn btn-ghost btn-sm">
          {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <span className="hidden sm:inline">{loading ? t('health.checking') : t('health.recheck')}</span>
        </button>
      </div>

      {error && !report && (
        <div className="p-4"><Notice tone="warn" title={t('health.loadFailed')}>{error}</Notice></div>
      )}

      {!report && loading && (
        <ul className="divide-y divide-line" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="skeleton h-[18px] w-[18px] rounded-full" />
              <span className="skeleton h-3 w-28 rounded" />
              <span className="skeleton ms-auto h-3 w-40 rounded" />
            </li>
          ))}
        </ul>
      )}

      {report && (
        <ul className={cn('stagger divide-y divide-line transition-opacity duration-fast', loading && 'opacity-60')}>
          {report.checks.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <StatusIcon status={c.status} className="mt-px" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{t(`health.rows.${c.id}`)}</p>
                  <p className="mt-0.5 break-words text-xs leading-5 text-ink-3">
                    {t(`health.codes.${c.code}`, { detail: c.detail, defaultValue: c.detail ?? c.code })}
                  </p>
                </div>
              </div>
              {canManage && c.fix && c.status !== 'ok' && c.status !== 'skip' && (
                <FixButton fix={c.fix} busy={fixing && c.fix === 'webhook'} onRun={() => runFix(c.fix!)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {(openFix || fixedNote) && (
        <div className="space-y-3 border-t border-line p-4">
          {fixedNote && <Notice tone="success" title={fixedNote} />}
          {openFix === 'register' && (
            <RegisterNumberCard onDone={() => { setOpenFix(null); void load(true); }} />
          )}
          {openFix === 'webhook' && (
            <ManualWebhookCard
              callbackUrl={manualWebhook?.callbackUrl ?? null}
              verifyToken={manualWebhook?.verifyToken ?? null}
              onFixed={() => { setOpenFix(null); void load(true); }}
            />
          )}
        </div>
      )}

      {!canManage && report && problems > 0 && (
        <p className="border-t border-line px-4 py-3 text-xs text-ink-3">{t('health.managerOnly')}</p>
      )}
    </section>
  );
}

function FixButton({ fix, busy, onRun }: { fix: NonNullable<Check['fix']>; busy: boolean; onRun: () => void }) {
  const { t } = useTranslation('whatsapp');
  const external = fix === 'billing' ? META_LINKS.billing : fix === 'whatsapp_manager' ? META_LINKS.waManager : null;
  if (external) {
    return (
      <a href={external} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm ms-[30px] self-start sm:ms-0 sm:self-auto">
        {t(`health.fix.${fix}`)} <ExternalLink aria-hidden="true" />
      </a>
    );
  }
  return (
    <button type="button" onClick={onRun} disabled={busy} className="btn btn-secondary btn-sm ms-[30px] self-start sm:ms-0 sm:self-auto">
      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
      {t(`health.fix.${fix}`)}
    </button>
  );
}
