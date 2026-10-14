'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Hand, ShoppingCart, TrendingUp, MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';
import type { AppNotification, NotificationType } from '@/hooks/useNotifications';

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  BUYING_INTENT: ShoppingCart,
  NEEDS_ATTENTION: Hand,
  STATUS_UPGRADE: TrendingUp,
};

/**
 * Short, pleasant two-note chime via the Web Audio API — no asset to ship and
 * no autoplay restriction once the user has interacted with the page (which is
 * always the case inside the dashboard). Best-effort: silently no-ops if audio
 * is unavailable or blocked.
 */
let audioCtx: AudioContext | null = null;
function playAlertChime() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    // Rising perfect-fourth (A5 → D6) — friendly, "ping"-like, not alarming.
    [{ f: 880, t: 0 }, { f: 1174.66, t: 0.11 }].forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.linearRampToValueAtTime(0.16, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.32);
    });
  } catch {
    /* audio not available / blocked — ignore */
  }
}

/** Per-type visual identity — gradient avatar, accent rail, countdown bar, glow. */
const TYPE_TONE: Record<
  NotificationType,
  { rail: string; avatar: string; label: string; bar: string; glow: string; dot: string }
> = {
  NEEDS_ATTENTION: {
    rail: 'bg-blue-500',
    avatar: 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-[0_4px_14px_rgba(59,130,246,0.45)]',
    label: 'text-blue-600 dark:text-sky-400',
    bar: 'bg-blue-500',
    glow: 'shadow-[0_20px_60px_-15px_rgba(59,130,246,0.45)]',
    dot: 'bg-blue-500',
  },
  BUYING_INTENT: {
    rail: 'bg-brand',
    avatar: 'bg-brand text-white shadow-[0_4px_14px_rgba(37,211,102,0.45)]',
    label: 'text-brand-strong dark:text-brand',
    bar: 'bg-brand',
    glow: 'shadow-[0_20px_60px_-15px_rgba(37,211,102,0.45)]',
    dot: 'bg-brand',
  },
  STATUS_UPGRADE: {
    rail: 'bg-amber-500',
    avatar: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-[0_4px_14px_rgba(245,158,11,0.45)]',
    label: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    glow: 'shadow-[0_20px_60px_-15px_rgba(245,158,11,0.45)]',
    dot: 'bg-amber-500',
  },
};

/** Higher-urgency alerts linger longer before auto-dismiss. */
function dismissDelay(n: AppNotification): number {
  if (n.type === 'NEEDS_ATTENTION' || n.priority === 'URGENT' || n.priority === 'HIGH') return 14000;
  return 9000;
}

const MAX_VISIBLE = 4;

/**
 * Floating, actionable alerts for high-value lead activity. Listens to the same
 * user-scoped `notification:new` socket events that feed the bell, and surfaces
 * hot leads / customers needing agent interaction as a side-anchored toast stack
 * with a direct "Open chat" action. Mounted once in the dashboard layout.
 */
export default function LeadAlertPopup() {
  const [stack, setStack] = useState<AppNotification[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const onNew = useCallback((n: AppNotification) => {
    // Dedup at the source so a re-delivered event never double-chimes.
    if (seenRef.current.has(n.id)) return;
    seenRef.current.add(n.id);
    playAlertChime();
    setStack((prev) => {
      if (prev.some((x) => x.id === n.id)) return prev;
      // Newest first; cap how many show at once so the screen never floods.
      return [n, ...prev].slice(0, MAX_VISIBLE);
    });
  }, []);
  useSocket('notification:new', onNew);

  const dismiss = useCallback((id: string) => {
    setStack((prev) => prev.filter((x) => x.id !== id));
  }, []);

  if (stack.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed end-0 top-0 z-[400] flex w-full max-w-[400px] flex-col gap-3 p-4 sm:end-4 sm:top-4"
      aria-label="Lead alerts"
    >
      {stack.map((n) => (
        <LeadAlertCard key={n.id} notification={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function LeadAlertCard({
  notification: n,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}) {
  const router = useRouter();
  const { t, i18n } = useTranslation('leads');
  const isAr = i18n.language.startsWith('ar');
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  const Icon = TYPE_ICON[n.type] ?? Hand;
  const tone = TYPE_TONE[n.type] ?? TYPE_TONE.STATUS_UPGRADE;
  const delay = dismissDelay(n);

  // Auto-dismiss with hover-pause: track remaining time across pause/resume.
  const remainingRef = useRef(delay);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pick = (pair: { en: string; ar: string } | null | undefined) =>
    pair ? (isAr ? pair.ar || pair.en : pair.en || pair.ar) : '';

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLeaving(true);
    // Let the exit transition play before unmount.
    setTimeout(() => onDismiss(n.id), 240);
  }, [n.id, onDismiss]);

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(close, remainingRef.current);
  }, [close]);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [startTimer]);

  const pause = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
    startTimer();
  };

  const openChat = () => {
    if (n.conversationId) {
      router.push(`/conversations?conversationId=${encodeURIComponent(n.conversationId)}`);
    } else {
      router.push('/leads');
    }
    close();
  };

  // Exit slides toward the anchored edge (right in LTR, left in RTL).
  const exitTranslate = isAr ? '-translate-x-6' : 'translate-x-6';

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={pause}
      onMouseLeave={resume}
      className={cn(
        'pointer-events-auto group relative w-full overflow-hidden rounded-xl border backdrop-blur-xl',
        'border-gray-200/80 bg-white/95 dark:border-white/10 dark:bg-[#1B262C]/95',
        tone.glow,
        'lead-alert-enter transition-all duration-300 ease-out',
        leaving ? cn('opacity-0', exitTranslate, 'scale-[0.97]') : 'opacity-100 translate-x-0 scale-100',
      )}
    >
      {/* Colored accent rail on the leading edge */}
      <span className={cn('absolute inset-y-0 start-0 w-1', tone.rail)} aria-hidden="true" />

      <div className="flex items-start gap-3 py-3.5 ps-5 pe-3">
        {/* Gradient avatar */}
        <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone.avatar)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('relative flex h-1.5 w-1.5', paused ? '' : 'animate-pulse')}>
              <span className={cn('inline-flex h-1.5 w-1.5 rounded-full', tone.dot)} />
            </span>
            <p className={cn('text-[10px] font-bold uppercase tracking-[0.08em]', tone.label)}>
              {t(`notifications.type.${n.type}`)}
            </p>
          </div>

          <p className="mt-1 truncate text-sm font-semibold text-ink">{pick(n.title)}</p>
          {n.body && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3">
              {pick(n.body)}
            </p>
          )}

          <button
            type="button"
            onClick={openChat}
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-fg',
              'shadow-[0_4px_14px_rgba(37,211,102,0.35)] transition-all hover:bg-brand-strong hover:shadow-[0_6px_18px_rgba(37,211,102,0.5)] active:scale-95',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {t('notifications.popup.openChat')}
          </button>
        </div>

        <button
          type="button"
          onClick={close}
          aria-label={t('notifications.popup.dismiss')}
          className={cn(
            'shrink-0 rounded-lg p-1 text-gray-400 opacity-0 transition-all group-hover:opacity-100',
            'hover:bg-gray-100 hover:text-ink-2-3 dark:hover:bg-white/10 dark:hover:text-white',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Countdown bar — depletes over the auto-dismiss window, pauses on hover */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/5 dark:bg-white/5" aria-hidden="true">
        <div
          className={cn('h-full', tone.bar)}
          style={{
            transformOrigin: isAr ? 'right' : 'left',
            animation: `leadAlertCountdown ${delay}ms linear forwards`,
            animationPlayState: paused || leaving ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}
