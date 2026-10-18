'use client';

/**
 * A template's WhatsApp approval state.
 *
 * There are two status fields on a template and users conflate them constantly:
 * `status` (DRAFT/PUBLISHED) is this CRM's own bookkeeping, while `metaStatus` is
 * WhatsApp's verdict — and only the second one decides whether the template can
 * reach anybody. A template can sit at PUBLISHED and still deliver to nobody.
 *
 * So everything here answers one question: can this be sent to a campaign
 * audience right now, and if not, what is the next action. "Not submitted" is
 * deliberately treated as its own state rather than folded into "not approved":
 * the fix is a button, not a wait.
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Clock, Send, XCircle, PauseCircle } from 'lucide-react';

type TFn = (key: string, options?: Record<string, unknown>) => string;

export type MetaStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | null | undefined;

export interface ApprovalFields {
  metaStatus?: MetaStatus;
  metaRejectedReason?: string | null;
  metaSubmittedAt?: string | null;
  metaQualityScore?: string | null;
  /** Saved in the CRM but not yet accepted by WhatsApp — sends still carry the approved version. */
  hasPendingEdits?: boolean;
  /** Why WhatsApp refused the last edit, when it did. */
  metaEditError?: string | null;
}

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

interface Descriptor {
  tone: Tone;
  label: string;
  /** Plain-language consequence, phrased in terms of who receives the message. */
  detail: string;
  icon: typeof CheckCircle2;
  /** True when submitting (or resubmitting) is the useful next step. */
  canSubmit: boolean;
}

/**
 * `t` is passed in rather than pulled from a hook so this stays a plain function
 * — it is called from list filters and card bodies, not only from components.
 */
export function describeApproval(template: ApprovalFields, t: TFn): Descriptor {
  // A live template with local edits: the edits reach nobody until resubmitted.
  if (template.hasPendingEdits && (template.metaStatus === 'APPROVED' || template.metaStatus === 'PAUSED')) {
    return {
      tone: template.metaEditError ? 'bad' : 'warn',
      label: template.metaEditError ? t('approval.editRejected') : t('approval.pendingEdits'),
      detail: template.metaEditError
        ? `${template.metaEditError} — ${t('approval.detailStillApproved')}`
        : t('approval.detailPendingEdits'),
      icon: template.metaEditError ? XCircle : AlertTriangle,
      canSubmit: true,
    };
  }
  switch (template.metaStatus) {
    case 'APPROVED':
      return {
        tone: 'good',
        label: t('approval.approved'),
        detail: t('approval.detailApproved'),
        icon: CheckCircle2,
        canSubmit: false,
      };
    case 'PENDING':
      return {
        tone: 'warn',
        label: t('approval.inReview'),
        detail: t('approval.detailInReview'),
        icon: Clock,
        canSubmit: false,
      };
    case 'REJECTED':
      return {
        tone: 'bad',
        label: t('approval.rejected'),
        // Meta's own wording wins when present: it is the only text that says
        // what to change, and translating it would misrepresent the reviewer.
        detail: template.metaRejectedReason?.trim() || t('approval.detailRejected'),
        icon: XCircle,
        canSubmit: true,
      };
    case 'PAUSED':
      return {
        tone: 'bad',
        label: t('approval.paused'),
        detail: t('approval.detailPaused'),
        icon: PauseCircle,
        canSubmit: false,
      };
    case 'DISABLED':
      return {
        tone: 'bad',
        label: t('approval.disabled'),
        detail: t('approval.detailDisabled'),
        icon: XCircle,
        canSubmit: false,
      };
    default:
      return {
        tone: 'neutral',
        label: t('approval.notSubmitted'),
        detail: t('approval.detailNotSubmitted'),
        icon: AlertTriangle,
        canSubmit: true,
      };
  }
}

const PILL: Record<Tone, string> = {
  good: 'bg-brand/10 border-brand/25 text-brand dark:text-brand',
  warn: 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400',
  bad: 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400',
  neutral: 'bg-gray-100 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-ink-3',
};

/** Compact pill for cards and lists. */
export function ApprovalBadge({ template }: { template: ApprovalFields }) {
  const { t } = useTranslation('templates');
  const { tone, label, icon: Icon } = describeApproval(template, t as TFn);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PILL[tone]}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

/**
 * Full status block with the submit action.
 *
 * The button is the only route to `POST /api/templates/:id/submit`. Before this
 * existed the endpoint was unreachable from the UI, so no template could ever
 * become APPROVED and every broadcast parked at TEMPLATE_MISSING.
 */
export function ApprovalPanel({
  template,
  submitting,
  onSubmit,
  disabledReason,
  hideSubmit,
}: {
  template: ApprovalFields;
  submitting?: boolean;
  onSubmit: () => void;
  /** Set when submission is impossible (e.g. no number connected), with the reason. */
  disabledReason?: string | null;
  /** The page already offers submit elsewhere (e.g. a sticky action bar). */
  hideSubmit?: boolean;
}) {
  const { t } = useTranslation('templates');
  const { tone, label, detail, icon: Icon, canSubmit } = describeApproval(template, t as TFn);

  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === 'good'
          ? 'border-brand/25 bg-brand/5'
          : tone === 'bad'
            ? 'border-rose-500/25 bg-rose-500/5'
            : tone === 'warn'
              ? 'border-amber-500/25 bg-amber-500/5'
              : 'border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            tone === 'good'
              ? 'text-brand dark:text-brand'
              : tone === 'bad'
                ? 'text-rose-500'
                : tone === 'warn'
                  ? 'text-amber-500'
                  : 'text-gray-400'
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">
            {t('approval.heading', { label })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">{detail}</p>

          {template.metaQualityScore && template.metaQualityScore !== 'GREEN' && (
            <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              {t('approval.qualityWarning', { score: template.metaQualityScore.toLowerCase() })}
            </p>
          )}

          {canSubmit && !hideSubmit && (
            <>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting || Boolean(disabledReason)}
                className="btn btn-primary btn-sm mt-3 inline-flex disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {submitting
                  ? t('approval.submitting')
                  : template.hasPendingEdits
                    ? t('approval.submitEdits')
                    : template.metaStatus === 'REJECTED'
                      ? t('approval.resubmit')
                      : t('approval.submit')}
              </button>
              {disabledReason && (
                <p className="mt-2 text-xs text-ink-3">{disabledReason}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
