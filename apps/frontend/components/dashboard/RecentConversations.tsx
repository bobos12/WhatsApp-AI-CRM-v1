'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MessageSquare, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { formatPhone } from '../../lib/phone';
import { useSocket } from '../../hooks/useSocket';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string };
  lastMessage: string | null;
  lastMessageAt: string | null;
}

// Circular avatar background/text colors — one per slot
const AVATAR_COLORS = [
  'bg-brand/15 text-brand-strong dark:bg-brand/15 dark:text-brand',
  'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400',
  'bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-400',
  'bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400',
  'bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400',
] as const;

function formatTime(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) {
    return locale.startsWith('ar') ? 'أمس' : 'Yesterday';
  }
  if (diffDays < 7) {
    return d.toLocaleDateString(locale, { weekday: 'short' });
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function RecentConversations() {
  const { t } = useTranslation('dashboard');
  const { i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-EG' : 'en-US';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await api.get('/api/conversations?limit=5');
      const list = Array.isArray(data) ? data : [];
      setConversations(list.slice(0, 5));
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const onMessageNew = useCallback(
    ({ conversationId, message }: { conversationId: string; message: { body?: string; createdAt: string } }) => {
      setConversations((prev) => {
        const exists = prev.find((c) => c.id === conversationId);
        if (exists) {
          const updated = { ...exists, lastMessage: message.body ?? exists.lastMessage, lastMessageAt: message.createdAt };
          return [updated, ...prev.filter((c) => c.id !== conversationId)].slice(0, 5);
        }
        fetchConversations();
        return prev;
      });
    },
    [fetchConversations],
  );

  const onConversationUpdated = useCallback(
    ({ conversationId, ...fields }: { conversationId: string; [key: string]: any }) => {
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, ...fields } : c)));
    },
    [],
  );

  useSocket('message:new', onMessageNew);
  useSocket('conversation:updated', onConversationUpdated);

  return (
    <section className="flex h-full flex-col rounded-xl bg-white/80 backdrop-blur-xl border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-5 dark:bg-raised dark:border-transparent dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-ink">{t('recentConversations.title')}</h2>
        <Link
          href="/conversations"
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-brand dark:border-white/10 dark:text-ink-3 dark:hover:border-brand/40 dark:hover:bg-brand/10 dark:hover:text-brand"
        >
          {t('recentConversations.viewAll')}
          <ArrowRight className="h-3.5 w-3.5 icon-mirror" aria-hidden="true" />
        </Link>
      </div>

      {/* List */}
      <div className="flex-1 space-y-0.5">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-3">
              <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-white/5" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between gap-2">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-white/5" />
                  <div className="h-3 w-10 animate-pulse rounded bg-gray-200 dark:bg-white/5" />
                </div>
                <div className="h-2.5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-white/5" />
              </div>
            </div>
          ))
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised">
              <MessageSquare className="h-5 w-5 text-ink-4" aria-hidden="true" />
            </span>
            <p className="text-sm text-ink-3">{t('recentConversations.noConversations')}</p>
          </div>
        ) : (
          conversations.map((conv, i) => {
            const display = conv.contact.name || formatPhone(conv.contact.phone);
            const initial = display.charAt(0).toUpperCase();
            const time = conv.lastMessageAt ? formatTime(conv.lastMessageAt, locale) : '';
            return (
              <Link
                key={conv.id}
                href={`/conversations?phone=${encodeURIComponent(conv.contact.phone)}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:hover:bg-white/5"
              >
                {/* Avatar — circular with initial, no icon */}
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                  aria-hidden="true"
                >
                  {initial}
                </span>

                {/* Text block */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {display.startsWith('+')
                        ? <span dir="ltr">{'‎'}{display}</span>
                        : <bdi>{display}</bdi>}
                    </p>
                    {time && (
                      <span className="shrink-0 text-[11px] text-ink-4">{time}</span>
                    )}
                  </div>
                  <p className="truncate text-[12px] text-ink-3">
                    {conv.lastMessage || t('recentConversations.noMessages')}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
