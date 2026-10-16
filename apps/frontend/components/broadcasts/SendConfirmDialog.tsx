'use client';

/**
 * The last look before a campaign goes out.
 *
 * A campaign can't be recalled: a thousand messages are a thousand messages,
 * billed by Meta and read on a thousand phones. So the send is two taps — the
 * second one on a summary of exactly what is about to happen (which template,
 * from which number, to how many people, when, and how long it will take), with
 * the message as the first recipient will read it.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, FileText, Loader2, Phone, Send, Users, X } from 'lucide-react';
import { formatPhone } from '../../lib/phone';

/** Measured live: about 3–4 template sends a second, one after another. */
const SENDS_PER_MINUTE = 200;

const TIER_CAPACITY: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
};

export default function SendConfirmDialog({
  open,
  busy,
  templateName,
  preview,
  recipients,
  fromNumber,
  messagingLimit,
  scheduledFor,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  templateName: string;
  preview: string;
  recipients: number;
  fromNumber: string | null;
  messagingLimit: string | null;
  /** Formatted schedule, or null for "now". */
  scheduledFor: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('broadcasts');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const minutes = Math.max(1, Math.ceil(recipients / SENDS_PER_MINUTE));
  const capacity = messagingLimit ? TIER_CAPACITY[messagingLimit] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] animate-fade-in sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-confirm-title"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl animate-slide-up sm:rounded-2xl sm:pb-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 id="send-confirm-title" className="text-base font-semibold text-ink">
              {scheduledFor
                ? t('confirm.titleScheduled', { count: recipients, formatted: recipients.toLocaleString() })
                : t('confirm.titleNow', { count: recipients, formatted: recipients.toLocaleString() })}
            </h2>
            <p className="mt-1 text-xs text-ink-3">{t('confirm.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={t('confirm.cancel')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mx-5 mt-4 divide-y divide-line rounded-xl border border-line text-[13px]">
          <Row icon={FileText} label={t('confirm.template')} value={templateName} />
          {fromNumber && <Row icon={Phone} label={t('confirm.from')} value={formatPhone(fromNumber)} ltr />}
          <Row
            icon={Users}
            label={t('confirm.to')}
            value={t('confirm.people', { count: recipients, formatted: recipients.toLocaleString() })}
          />
          <Row
            icon={scheduledFor ? Calendar : Clock}
            label={scheduledFor ? t('confirm.when') : t('confirm.duration')}
            value={scheduledFor ?? t('confirm.minutes', { count: minutes })}
          />
        </dl>

        <div className="mx-5 mt-3 rounded-xl bg-[#efeae2] p-2.5 dark:bg-[#0b141a]">
          {/* Clamped on the text, not the bubble, so the cut lands on a line edge. */}
          <div className="rounded-lg rounded-ss-none bg-white px-2.5 py-2 shadow-sm dark:bg-[#202c33]">
            <p
              dir="auto"
              className="line-clamp-5 whitespace-pre-wrap text-[12px] leading-relaxed text-[#111b21] dark:text-[#e9edef]"
            >
              {preview}
            </p>
          </div>
        </div>

        <ul className="mx-5 mt-3 space-y-1 text-[11px] leading-relaxed text-ink-3">
          {capacity && (
            <li>
              {t('confirm.dailyLimit', {
                used: recipients.toLocaleString(),
                capacity: capacity.toLocaleString(),
              })}
            </li>
          )}
          <li>{t('confirm.billing')}</li>
          <li>{t('confirm.canPause')}</li>
        </ul>

        <div className="flex gap-2 p-5">
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary h-11 flex-1 justify-center">
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="btn btn-primary h-11 flex-[1.4] justify-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 icon-mirror" />}
            {scheduledFor ? t('confirm.schedule') : t('confirm.sendNow')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  ltr,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-ink-4" />
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd dir={ltr ? 'ltr' : 'auto'} className="min-w-0 flex-1 truncate text-end font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}
