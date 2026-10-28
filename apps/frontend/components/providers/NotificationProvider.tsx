'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getSocket } from '../../lib/socket';
import { primeNotificationSound } from '../../lib/notifications';
import { useChatUnread } from '../../stores/chat-unread-store';
import { syncPushSubscription } from '../../lib/push';
import { isImpersonating } from '../../lib/api';
import { useNotificationStore } from '../../hooks/useNotifications';
import { useLanguage } from './I18nProvider';

/** Fired to open the notifications inbox from anywhere (e.g. a "N more" push). */
export const OPEN_INBOX_EVENT = 'nx:open-inbox';

/**
 * Mounted once in the dashboard layout. Owns everything about notifications
 * that is not drawn on screen:
 * - the unread-chats badge, driven by `message:new`
 * - the shared inbox store, kept fresh across reconnects and other tabs
 * - this device's push subscription, kept pointed at whoever is signed in and
 *   written in their language
 * - taps on phone notifications, routed client-side into the open app
 * - the unread count on the installed app's icon
 *
 * The live banner itself (and its sound) is NotificationBanner, fed by the
 * server's `notification:new` — every alert is a stored notification now.
 */
export default function NotificationProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { language } = useLanguage();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  // Clear the unread badge whenever the user opens the inbox.
  useEffect(() => {
    if (pathname?.startsWith('/conversations')) {
      useChatUnread.getState().reset();
    }
  }, [pathname]);

  // Arrived from a notification tap: mark it read, open the inbox if asked,
  // then tidy the URL. history.replaceState (not the router) so this never
  // races a page's own URL rewrite, e.g. the inbox turning conversationId into c.
  const handledNids = useRef(new Set<string>());
  useEffect(() => {
    const nid = searchParams.get('nid');
    const inbox = searchParams.get('inbox');
    if (!nid && !inbox) return;
    if (nid && !handledNids.current.has(nid)) {
      handledNids.current.add(nid);
      void useNotificationStore.getState().markRead(nid);
    }
    if (inbox) window.dispatchEvent(new Event(OPEN_INBOX_EVENT));
    const url = new URL(window.location.href);
    url.searchParams.delete('nid');
    url.searchParams.delete('inbox');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams]);

  // Whoever signs in on this device takes over its notifications, in their
  // language. Not while impersonating: the device stays the operator's own.
  useEffect(() => {
    if (!isImpersonating()) void syncPushSubscription(userId);
  }, [userId, language]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'OPEN_URL' && typeof e.data.url === 'string') router.push(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  // The installed app's icon shows the unread count.
  useEffect(() => {
    const apply = (count: number) => {
      const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (!nav.setAppBadge) return;
      void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
    };
    apply(useNotificationStore.getState().unread);
    return useNotificationStore.subscribe((s, prev) => { if (s.unread !== prev.unread) apply(s.unread); });
  }, []);

  useEffect(() => {
    primeNotificationSound();
    const store = useNotificationStore.getState();
    if (!store.loaded) void store.refetch();

    const socket = getSocket();

    let lastMessageId: string | null = null;
    function onNewMessage(data: { conversationId: string; message?: { id?: string; fromMe?: boolean; direction?: string } }) {
      const msg = data.message;
      if (!msg || msg.fromMe) return;
      if (msg.direction && msg.direction.toUpperCase() === 'OUTBOUND') return;
      // The same message can arrive via more than one emit path.
      if (msg.id && msg.id === lastMessageId) return;
      lastMessageId = msg.id ?? null;
      const watching = !!pathRef.current?.startsWith('/conversations') && document.hasFocus();
      if (!watching) useChatUnread.getState().bump();
    }
    // Read elsewhere (another tab, or by opening the chat) — or events missed
    // while disconnected: reload the inbox.
    const refetch = () => void useNotificationStore.getState().refetch();

    socket.on('message:new', onNewMessage);
    socket.on('notifications:changed', refetch);
    socket.io.on('reconnect', refetch);
    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('notifications:changed', refetch);
      socket.io.off('reconnect', refetch);
    };
  }, []);

  return null;
}
