'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { CheckCheck, CornerUpLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/lib/phone';
import { formatAgo } from '@/lib/format';
import { useSocket } from '@/hooks/useSocket';
import Avatar from '@/components/ui/Avatar';
import { Panel, EmptyState } from '@/components/ui/page';
import { Skeleton } from '@/components/ui/Skeleton';

interface Row {
  id: string;
  contact: { id?: string; name: string | null; phone: string; customFields?: { avatarUrl?: string | null } | null };
  lastMessage?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt: string | null;
  unreadCount?: number;
  assignedUser?: { name: string | null; email: string } | null;
}

const SHOW = 6;

/**
 * "What should I do next?" answered literally: the customers who are waiting,
 * longest wait first, each one a click away from a reply. Unread chats lead;
 * chats that are open but answered follow, so the list is never empty while
 * there is still something open to look at.
 */
export default function AttentionQueue({ onSummary }: { onSummary?: (s: { waiting: number; oldest: string | null }) => void } = {}) {
  const { t } = useTranslation('dashboard');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/conversations?status=OPEN&limit=40');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Wait times are relative; re-render each minute so "4m" becomes "5m".
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);

  // A burst of inbound messages becomes one refetch, not one per message.
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void load(); }, 700);
  }, [load]);
  useSocket('message:new', soon);
  useSocket('conversation:updated', soon);

  const waiting = (rows ?? [])
    .filter((r) => (r.unreadCount ?? 0) > 0)
    .sort((a, b) => new Date(a.lastMessageAt ?? 0).getTime() - new Date(b.lastMessageAt ?? 0).getTime());
  const answered = (rows ?? [])
    .filter((r) => !((r.unreadCount ?? 0) > 0))
    .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());
  const list = [...waiting, ...answered].slice(0, SHOW);
  const oldest = waiting[0]?.lastMessageAt ?? null;
  // Feeds the dashboard's written briefing, which has no list of its own.
  useEffect(() => { if (rows) onSummary?.({ waiting: waiting.length, oldest }); }, [rows, waiting.length, oldest, onSummary]);
  const rest = Math.max(0, waiting.length + answered.length - SHOW);

  return (
    <Panel open
      title={
        <span className="flex items-center gap-2">
          {t('today.queue.title')}
          {waiting.length > 0 && <span className="chip chip-warn tabular-nums">{waiting.length}</span>}
        </span>
      }
      description={t('today.queue.sub')}
      actions={<Link href="/conversations" className="btn btn-ghost btn-sm">{t('today.queue.viewAll')}</Link>}
      className="h-full"
    >
      {rows === null ? (
        <ul className="divide-y divide-line">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3 rounded" /><Skeleton className="h-2.5 w-2/3 rounded" /></div>
            </li>
          ))}
        </ul>
      ) : list.length === 0 ? (
        <EmptyState icon={CheckCheck} title={t('today.queue.emptyTitle')} description={t('today.queue.emptySub')} />
      ) : (
        <ul className="stagger divide-y divide-line">
          {list.map((r) => {
            const name = r.contact?.name || formatPhone(r.contact?.phone || '');
            const unread = (r.unreadCount ?? 0) > 0;
            const href = `/conversations?conversationId=${encodeURIComponent(r.id)}`;
            return (
              <li key={r.id}>
                <Link href={href} className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors duration-fast hover:bg-raised/70">
                  <div className="relative">
                    <Avatar src={r.contact?.customFields?.avatarUrl} name={name} contactId={r.contact?.id} size={40} />
                    {unread && <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-surface" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className={cn('truncate text-[13px] text-ink', unread ? 'font-semibold' : 'font-medium')}>
                        {name.startsWith('+') ? <span dir="ltr">{name}</span> : <bdi>{name}</bdi>}
                      </p>
                      {r.lastMessageAt && (
                        <span className={cn('shrink-0 text-2xs tabular-nums', unread ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-ink-4')}>
                          {unread ? t('today.queue.waitingFor', { time: formatAgo(r.lastMessageAt) }) : formatAgo(r.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    <p className={cn('mt-0.5 truncate text-xs', unread ? 'text-ink-2' : 'text-ink-3')}>
                      <bdi>{r.lastMessagePreview ?? r.lastMessage ?? '—'}</bdi>
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-2xs text-ink-3 md:block">
                    {r.assignedUser ? (r.assignedUser.name || r.assignedUser.email) : <span className="text-ink-4">{t('today.queue.unassigned')}</span>}
                  </span>
                  <span className={cn(
                    'btn btn-sm shrink-0',
                    unread ? 'btn-primary' : 'btn-secondary opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden',
                  )}>
                    <CornerUpLeft aria-hidden="true" className="icon-mirror" />
                    <span className="hidden sm:inline">{t('today.queue.reply')}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rest > 0 && (
        <Link href="/conversations" className="block border-t border-line px-4 py-2.5 text-center text-xs font-medium text-ink-3 transition-colors hover:bg-raised/70 hover:text-ink">
          {t('today.queue.more', { count: rest })}
        </Link>
      )}
    </Panel>
  );
}
