'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../lib/api';

export type NotificationType =
  | 'MESSAGE'
  | 'ASSIGNMENT'
  | 'MENTION'
  | 'NOTE'
  | 'TASK_DUE'
  | 'REMINDER'
  | 'TEST'
  | 'BUYING_INTENT'
  | 'NEEDS_ATTENTION'
  | 'STATUS_UPGRADE';

export interface AppNotification {
  id: string;
  type: NotificationType;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  title: { en: string; ar: string };
  body: { en: string; ar: string } | null;
  contactId: string | null;
  conversationId: string | null;
  /** Who caused it — drives the avatar initials. */
  actorName?: string | null;
  /** Where tapping it goes. */
  url?: string | null;
  /** Messages in one chat fold into one notification; this counts them. */
  groupCount?: number;
  isRead: boolean;
  createdAt: string;
}

export function notificationHref(n: Pick<AppNotification, 'url' | 'conversationId'>): string {
  if (n.url) return n.url;
  return n.conversationId ? `/conversations?conversationId=${encodeURIComponent(n.conversationId)}` : '/dashboard';
}

interface NotificationsState {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  loaded: boolean;
  refetch: () => Promise<void>;
  /** A live `notification:new` — a new one, or a folded chat notification that changed. */
  receive: (n: AppNotification) => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * The signed-in person's notifications: one store shared by the bell, the
 * live banner and Settings, so they never disagree. Fed by the API on load and
 * by the user-scoped `notification:new` socket event (wired once in
 * NotificationProvider).
 */
export const useNotificationStore = create<NotificationsState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  loaded: false,

  refetch: async () => {
    set({ loading: true });
    try {
      const [list, count] = await Promise.all([
        api.get('/api/notifications?limit=30'),
        api.get('/api/notifications/unread-count'),
      ]);
      set({
        items: Array.isArray(list) ? list : [],
        unread: typeof count?.count === 'number' ? count.count : 0,
        loaded: true,
      });
    } catch {
      /* keep prior state on failure */
    } finally {
      set({ loading: false });
    }
  },

  receive: (n) => {
    const prev = get().items;
    const existing = prev.find((x) => x.id === n.id);
    // A folded chat notification moves back to the top; it only adds to the
    // unread count if it had already been read.
    const items = [n, ...prev.filter((x) => x.id !== n.id)].slice(0, 50);
    const bump = !n.isRead && (!existing || existing.isRead) ? 1 : 0;
    set({ items, unread: get().unread + bump });
  },

  markRead: async (id) => {
    const target = get().items.find((x) => x.id === id);
    if (target && !target.isRead) {
      set({
        items: get().items.map((x) => (x.id === id ? { ...x, isRead: true } : x)),
        unread: Math.max(0, get().unread - 1),
      });
    }
    try { await api.post(`/api/notifications/${id}/read`, {}); } catch { /* best-effort */ }
  },

  markAllRead: async () => {
    set({ items: get().items.map((x) => ({ ...x, isRead: true })), unread: 0 });
    try { await api.post('/api/notifications/read-all', {}); } catch { /* best-effort */ }
  },
}));

/** Read the shared notifications; loads them the first time anyone asks. */
export function useNotifications() {
  const state = useNotificationStore();
  useEffect(() => {
    const s = useNotificationStore.getState();
    if (!s.loaded && !s.loading) void s.refetch();
  }, []);
  return state;
}
