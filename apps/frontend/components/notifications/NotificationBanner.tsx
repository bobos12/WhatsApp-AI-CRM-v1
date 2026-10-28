'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, AtSign, BellRing, CalendarClock, Clock, MessageCircle,
  ShoppingCart, StickyNote, TrendingUp, UserPlus, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';
import { avatarTone } from '@/components/ui/Avatar';
import {
  notificationHref, useNotificationStore, type AppNotification, type NotificationType,
} from '@/hooks/useNotifications';
import { playNotificationSound, showBrowserNotification } from '@/lib/notifications';
import { isDeviceOn } from '@/lib/push';

export const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  MESSAGE: MessageCircle,
  ASSIGNMENT: UserPlus,
  MENTION: AtSign,
  NOTE: StickyNote,
  TASK_DUE: CalendarClock,
  REMINDER: Clock,
  TEST: BellRing,
  BUYING_INTENT: ShoppingCart,
  NEEDS_ATTENTION: AlertTriangle,
  STATUS_UPGRADE: TrendingUp,
};

const DISMISS_MS = 6000;
const MAX_VISIBLE = 3;

export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

/** The person behind it as initials, or the type's icon for system alerts. */
export function NotificationAvatar({ n, size = 40 }: { n: AppNotification; size?: number }) {
  const Icon = TYPE_ICON[n.type] ?? BellRing;
  const initials = n.actorName ? initialsOf(n.actorName) : '';
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full font-semibold',
        initials ? avatarTone(n.actorName!) : 'bg-brand/10 text-brand',
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials || <Icon style={{ width: size * 0.45, height: size * 0.45 }} />}
      {initials && (
        <span className="absolute -bottom-0.5 -end-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand text-brand-fg ring-2 ring-surface">
          <Icon className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}

/**
 * The live in-app alert: drops in from the top like a phone notification,
 * with a soft chime. Shown for every `notification:new` unless the person is
 * already looking at that exact chat. When the tab is in the background and
 * this device has no phone push, a system notification stands in for it.
 */
export default function NotificationBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stack, setStack] = useState<AppNotification[]>([]);
  const seen = useRef<Map<string, number>>(new Map());
  const view = useRef({ pathname, chat: searchParams.get('c') });
  useEffect(() => { view.current = { pathname, chat: searchParams.get('c') }; }, [pathname, searchParams]);
  const { i18n } = useTranslation();
  const isAr = i18n.language.startsWith('ar');

  // Known once per session: if this device gets phone pushes, the service
  // worker covers the background case and we must not double up.
  const pushOn = useRef<boolean | null>(null);
  useEffect(() => {
    isDeviceOn().then((s) => { pushOn.current = s.on; }).catch(() => { pushOn.current = false; });
  }, []);

  const onNew = useCallback((n: AppNotification) => {
    useNotificationStore.getState().receive(n);

    // A folded chat notification re-fires per message; a repeat within a
    // couple of seconds is the same burst, not a new alert.
    const stamp = `${n.id}:${n.groupCount ?? 1}`;
    if (seen.current.has(stamp)) return;
    seen.current.set(stamp, Date.now());

    const { pathname: path, chat } = view.current;
    const lookingAtIt = !!n.conversationId && !!path?.startsWith('/conversations') && chat === n.conversationId;
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';

    if (!visible) {
      if (pushOn.current === false) {
        const pick = (p: { en: string; ar: string } | null) => (p ? (isAr ? p.ar || p.en : p.en || p.ar) : '');
        showBrowserNotification(pick(n.title), pick(n.body), { tag: n.conversationId ? `conv:${n.conversationId}` : n.id, href: notificationHref(n) });
      }
      return;
    }
    if (lookingAtIt) return;

    playNotificationSound();
    setStack((prev) => [n, ...prev.filter((x) => x.id !== n.id)].slice(0, MAX_VISIBLE));
  }, [isAr]);
  useSocket('notification:new', onNew);

  const dismiss = useCallback((id: string) => setStack((prev) => prev.filter((x) => x.id !== id)), []);

  // Opening the chat by other means clears its banner.
  useEffect(() => {
    const chat = searchParams.get('c');
    if (chat) setStack((prev) => prev.filter((x) => x.conversationId !== chat));
  }, [searchParams]);

  if (stack.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 top-0 z-[400] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {stack.map((n) => (
        <BannerCard key={`${n.id}:${n.groupCount ?? 1}`} n={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function BannerCard({ n, onDismiss }: { n: AppNotification; onDismiss: (id: string) => void }) {
  const router = useRouter();
  const { t, i18n } = useTranslation('settings');
  const isAr = i18n.language.startsWith('ar');
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DISMISS_MS);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchY = useRef<number | null>(null);

  const pick = (p: { en: string; ar: string } | null | undefined) => (p ? (isAr ? p.ar || p.en : p.en || p.ar) : '');

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setLeaving(true);
    setTimeout(() => onDismiss(n.id), 200);
  }, [n.id, onDismiss]);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    timer.current = setTimeout(close, remaining.current);
  }, [close]);

  useEffect(() => {
    start();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [start]);

  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
    remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    setPaused(true);
  };
  const resume = () => { setPaused(false); start(); };

  const open = () => {
    void useNotificationStore.getState().markRead(n.id);
    router.push(notificationHref(n));
    close();
  };

  return (
    <div
      role="alert"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onTouchStart={(e) => { touchY.current = e.touches[0].clientY; pause(); }}
      onTouchEnd={(e) => {
        const dy = touchY.current === null ? 0 : e.changedTouches[0].clientY - touchY.current;
        touchY.current = null;
        // Flick it up and away, like a phone banner.
        if (dy < -24) close(); else resume();
      }}
      className={cn(
        'pointer-events-auto relative w-full max-w-[420px] overflow-hidden rounded-2xl bg-surface shadow-pop',
        leaving ? 'banner-leave' : 'banner-enter',
      )}
    >
      <div className="flex items-start gap-3 p-3 pe-2">
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <NotificationAvatar n={n} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-brand">
                {t(`notify.type.${n.type}`, { defaultValue: '' })}
              </span>
              <span className="text-[10.5px] text-ink-4">{isAr ? 'الآن' : 'now'}</span>
            </span>
            <span className="mt-0.5 block truncate text-[13.5px] font-semibold leading-snug text-ink">
              <bdi>{pick(n.title)}</bdi>
            </span>
            {n.body && (
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-3">
                <bdi>{pick(n.body)}</bdi>
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={close}
          aria-label={t('notify.banner.dismiss')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-line/60" aria-hidden="true">
        <div
          className="h-full bg-brand/70"
          style={{
            transformOrigin: isAr ? 'right' : 'left',
            animation: `leadAlertCountdown ${DISMISS_MS}ms linear forwards`,
            animationPlayState: paused || leaving ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}
