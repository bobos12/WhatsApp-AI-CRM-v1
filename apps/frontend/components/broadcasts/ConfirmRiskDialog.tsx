'use client';

/**
 * ─── Critical-risk confirmation ──────────────────────────────────────────────
 *
 * The server answers 428 when a campaign it rated CRITICAL is sent without an
 * acknowledgement, and this is what that turns into on screen.
 *
 * It is intentionally the only modal in the broadcast flow. Everything else in
 * the redesign nudges, explains and offers fixes inline; this is the one place
 * where the cost of being wrong is the WhatsApp number itself, so it asks for a
 * deliberate second action. Making the confirm button secondary and the cancel
 * button primary is part of that — the default gesture should be to go back and
 * fix the campaign, not to push through.
 */

import { AlertOctagon, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ConfirmRiskDialog({
  open,
  reason,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  reason: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('broadcasts');
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-red-400/30 bg-white p-5 shadow-2xl dark:bg-[#111B21]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
            <AlertOctagon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t('risk.confirmTitle', { defaultValue: 'This campaign could get your number restricted' })}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600 dark:text-[#8696A0]">
              {reason ??
                t('risk.confirmBody', {
                  defaultValue:
                    'The safety check rated this campaign critical risk. Sending it as it stands may lead WhatsApp to restrict this Business account.',
                })}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('risk.sendAnyway', { defaultValue: 'Send anyway' })}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-[#25D366]/90"
          >
            <ShieldCheck className="h-4 w-4" />
            {t('risk.reviewFirst', { defaultValue: 'Review the report first' })}
          </button>
        </div>
      </div>
    </div>
  );
}
