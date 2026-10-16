'use client';

/**
 * Pre-flight report for a campaign.
 *
 * Answers three questions, in the order a sender actually asks them: can this
 * send at all, who will receive it, and is anything about the number worth
 * knowing first.
 *
 * The previous version showed a 0–100 "risk score" and an account health grade
 * computed from send failures. Both were inferences about an unofficial
 * transport that could be banned. On the official API there is nothing to infer:
 * Meta publishes the quality rating and the messaging limit, and the only thing
 * that truly stops a campaign is a template it has not approved. Showing a
 * confident-looking score derived from nothing would be worse than showing less.
 */

import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  formatMessagingLimit,
  qualityLabel,
  qualityTone,
  type PreflightFinding,
  type PreflightReport,
} from '../../lib/preflight';
import { formatPhone } from '../../lib/phone';

interface SafetyReportProps {
  report: PreflightReport | null | undefined;
  compact?: boolean;
  /** Invoked when the user taps a finding's one-tap remedy. */
  onApplyFix?: (finding: PreflightFinding) => void;
}

const TONE_CLASSES = {
  good: 'text-brand dark:text-brand',
  warn: 'text-amber-500',
  bad: 'text-red-500',
  neutral: 'text-ink-3',
} as const;

export default function SafetyReport({ report, compact, onApplyFix }: SafetyReportProps) {
  const { t } = useTranslation('broadcasts');
  // A campaign saved before this screen existed, or one whose report failed to
  // generate, must not blank the page.
  if (!report || !report.audience) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-ink-3">
        {t('safety.noReport')}
      </div>
    );
  }

  const blockers = report.findings.filter((f) => f.kind === 'blocker');
  const advisories = report.findings.filter((f) => f.kind !== 'blocker');
  const { audience, channel, template } = report;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Verdict ───────────────────────────────────────────────────────── */}
      <div
        className={`flex items-start gap-3 rounded-2xl p-4 ${
          report.canSend
            ? 'bg-brand/10'
            : 'bg-red-500/10'
        }`}
      >
        {report.canSend ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand dark:text-brand" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {report.canSend ? t('safety.readyToSend') : t('safety.cannotSend')}
          </p>
          <p className="mt-0.5 text-xs text-ink-2">
            {report.canSend
              ? t('safety.willReceive', { count: audience.deliverable, formatted: audience.deliverable.toLocaleString() })
              : t('safety.issuesFirst', { count: blockers.length })}
          </p>
        </div>
      </div>

      {/* ── Blockers ──────────────────────────────────────────────────────── */}
      {blockers.map((finding) => (
        <FindingRow key={finding.key} finding={finding} onApplyFix={onApplyFix} />
      ))}

      {/* ── Audience ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-400" />
          <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
            {t('safety.audience')}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('safety.statSelected')} value={audience.requested} />
          <Stat label={t('safety.statWillReceive')} value={audience.deliverable} emphasis />
          {audience.duplicates > 0 && <Stat label={t('safety.statDuplicates')} value={audience.duplicates} />}
          {audience.invalid > 0 && <Stat label={t('safety.statInvalid')} value={audience.invalid} />}
          {audience.alreadyReceived > 0 && (
            <Stat label={t('safety.statAlreadyMessaged')} value={audience.alreadyReceived} />
          )}
        </div>
      </div>

      {/* ── Number + template ─────────────────────────────────────────────── */}
      {!compact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-gray-400" />
              <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
                {t('safety.yourNumber')}
              </p>
            </div>
            <p dir="ltr" className="mt-2 text-start font-mono text-sm text-ink">
              {channel.displayPhoneNumber ? formatPhone(channel.displayPhoneNumber) : t('safety.notConnected')}
            </p>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">{t('safety.quality')}</dt>
                <dd className={`font-semibold ${TONE_CLASSES[qualityTone(channel.qualityRating)]}`}>
                  {t(`safety.quality_${channel.qualityRating}`, { defaultValue: qualityLabel(channel.qualityRating) })}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">{t('safety.dailyLimit')}</dt>
                <dd className="font-semibold text-ink">
                  {channel.messagingLimit && /^TIER_\d+K?$/.test(channel.messagingLimit)
                    ? t('safety.perDay', { limit: channel.messagingLimit.replace(/^TIER_/, '').replace('K', ',000') })
                    : channel.messagingLimit
                      ? formatMessagingLimit(channel.messagingLimit)
                      : t('safety.limitUnknown')}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-gray-400" />
              <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
                {t('safety.template')}
              </p>
            </div>
            {template ? (
              <>
                <p dir="auto" className="mt-2 truncate text-sm font-medium text-ink">
                  {template.name}
                </p>
                <p
                  className={`mt-1 text-xs font-semibold ${
                    template.status === 'APPROVED'
                      ? 'text-brand dark:text-brand'
                      : template.status === 'PENDING'
                        ? 'text-amber-500'
                        : 'text-red-500'
                  }`}
                >
                  {template.status === 'APPROVED'
                    ? t('safety.templateApproved')
                    : template.status === 'PENDING'
                      ? t('safety.templatePending')
                      : (template.status ?? t('safety.templateNotSubmitted'))}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-ink-3">
                {t('safety.noTemplate')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Advisories ────────────────────────────────────────────────────── */}
      {advisories.map((finding) => (
        <FindingRow key={finding.key} finding={finding} onApplyFix={onApplyFix} />
      ))}
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div>
      <p
        className={`text-lg font-bold ${
          emphasis ? 'text-brand dark:text-brand' : 'text-ink'
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] text-ink-3">{label}</p>
    </div>
  );
}

function FindingRow({
  finding,
  onApplyFix,
}: {
  finding: PreflightFinding;
  onApplyFix?: (f: PreflightFinding) => void;
}) {
  const style =
    finding.kind === 'blocker'
      ? { wrap: 'bg-red-500/10', icon: <XCircle className="h-4 w-4 text-red-500" /> }
      : finding.kind === 'warning'
        ? { wrap: 'bg-amber-500/10', icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> }
        : { wrap: 'bg-blue-500/10', icon: <Lightbulb className="h-4 w-4 text-blue-500" /> };

  // Findings arrive in English from the server; render them in the user's
  // language when there is a translation for the key, with the server's values.
  const { t, i18n } = useTranslation('broadcasts');
  const base = `safety.findings.${finding.key.split(':')[0]}`;
  const params: Record<string, string | number> = { ...(finding.params ?? {}) };
  // "SA:10,EG:2" → "Saudi Arabia 10, Egypt 2" in the reader's language.
  if (typeof params.countries === 'string') {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([i18n.language], { type: 'region' }); } catch { /* old browser */ }
    params.breakdown = params.countries
      .split(',')
      .map((pair) => {
        const [code, n] = pair.split(':');
        return `${(code !== '??' && names?.of(code)) || code} ${Number(n).toLocaleString(i18n.language)}`;
      })
      .join(i18n.language.startsWith('ar') ? '، ' : ', ');
  }
  const label = t(`${base}.label`, { ...params, defaultValue: finding.label });
  const detail = t(
    [`${base}.detail_${String(params.status ?? '')}`, `${base}.detail`],
    { ...params, defaultValue: finding.detail },
  );
  const fixLabel = finding.fix ? t(`${base}.fix`, { defaultValue: finding.fix.label }) : '';

  return (
    <div className={`flex items-start gap-3 rounded-2xl p-3.5 ${style.wrap}`}>
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-ink">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
          {detail}
        </p>
        {finding.fix && onApplyFix && (
          <button
            type="button"
            onClick={() => onApplyFix(finding)}
            className="mt-2 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
          >
            {fixLabel}
          </button>
        )}
      </div>
    </div>
  );
}
