'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import {
  type Lead, StatusBadge, PriorityBadge, FlagChips, SignalChips,
  scoreColor, localizedText,
} from './lead-ui';

/**
 * Compact AI sales-intelligence card for the conversation right-panel.
 * Self-contained: loads the contact's qualification, live-updates on
 * `lead:updated`, and offers a manual re-analyze.
 */
export default function QualificationPanel({ contactId }: { contactId?: string }) {
  const { t, i18n } = useTranslation('leads');
  const { success, error: toastError } = useToast();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const fetchLead = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const data = await api.get(`/api/leads/${contactId}`);
      setLead(data?.qualification ?? null);
    } catch {
      setLead(null);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetchLead(); }, [fetchLead]);

  const onLeadUpdated = useCallback((payload: { qualification?: { contactId?: string } }) => {
    if (payload?.qualification?.contactId === contactId) void fetchLead();
  }, [contactId, fetchLead]);
  useSocket('lead:updated', onLeadUpdated);

  const analyze = async () => {
    if (!contactId) return;
    setAnalyzing(true);
    try {
      const res = await api.post(`/api/leads/${contactId}/analyze`, {});
      if (res?.qualification) setLead(res.qualification);
      success(t('toast.analyzed'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('toast.analyzeFailed'));
    } finally {
      setAnalyzing(false);
    }
  };

  if (!contactId) return null;

  const summary = lead ? localizedText(lead, 'summary', i18n.language) : '';
  const recommendation = lead ? localizedText(lead, 'recommendation', i18n.language) : '';

  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">
        <Sparkles className="h-3 w-3 text-brand" />
        {t('panel.title')}
      </label>

      <div className="overflow-hidden rounded-xl border border-line bg-white dark:bg-raised">
        {/* No data / loading */}
        {!lead ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs text-ink-3">
              {loading ? '…' : t('panel.noData')}
            </p>
            <button
              type="button"
              onClick={analyze}
              disabled={analyzing}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand-strong dark:text-brand transition-colors hover:bg-brand/15 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', analyzing && 'animate-spin')} />
              {analyzing ? t('analyzing') : t('analyzeNow')}
            </button>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {/* Status + score */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={lead.status} />
                <PriorityBadge priority={lead.priority} />
              </div>
              <div className="text-end">
                <span className={cn('text-2xl font-bold leading-none', scoreColor(lead.score))}>{lead.score}</span>
                <span className="ms-1 text-[10px] uppercase tracking-wide text-ink-4/60">{t('score')}</span>
              </div>
            </div>

            <FlagChips lead={lead} />

            {summary && (
              <p className="text-xs leading-relaxed text-gray-600 dark:text-[#cfd9de]">{summary}</p>
            )}

            {recommendation && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4/70">{t('recommendation')}</p>
                <p className="rounded-xl border border-brand/15 bg-brand/5 px-3 py-2 text-xs leading-relaxed text-gray-700 dark:text-[#cfd9de]">
                  {recommendation}
                </p>
              </div>
            )}

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4/70">{t('signals')}</p>
              <SignalChips signals={lead.signals} />
            </div>

            <button
              type="button"
              onClick={analyze}
              disabled={analyzing}
              className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-3 transition-colors hover:text-brand disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', analyzing && 'animate-spin')} />
              {analyzing ? t('analyzing') : t('reanalyze')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
