'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/lib/phone';
import { useSocket } from '@/hooks/useSocket';
import Avatar from '@/components/ui/Avatar';
import { Panel, EmptyState } from '@/components/ui/page';
import { Skeleton } from '@/components/ui/Skeleton';

interface HotLead {
  id: string;
  status: string;
  score: number;
  conversationId: string | null;
  summaryEn?: string | null;
  summaryAr?: string | null;
  contact: { id: string; name: string | null; phone: string } | null;
}

/** The people most likely to buy, with the AI's one-line reason. */
export default function HotLeads() {
  const { t, i18n } = useTranslation('dashboard');
  const { t: tLeads } = useTranslation('leads');
  const isAr = i18n.language.startsWith('ar');
  const [leads, setLeads] = useState<HotLead[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/leads?status=HOT,QUALIFIED&limit=5');
      const list: HotLead[] = Array.isArray(data) ? data : [];
      setLeads(list.sort((a, b) => b.score - a.score).slice(0, 5));
    } catch {
      setLeads([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useSocket('lead:updated', load);

  return (
    <Panel open
      title={t('today.leads.title')}
      description={t('today.leads.sub')}
      actions={<Link href="/leads" className="btn btn-ghost btn-sm">{t('today.leads.viewAll')}</Link>}
      className="h-full"
    >
      {leads === null ? (
        <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
      ) : leads.length === 0 ? (
        <EmptyState compact icon={Flame} title={t('today.leads.empty')} description={t('today.leads.emptySub')} />
      ) : (
        <ul className="stagger divide-y divide-line">
          {leads.map((l) => {
            const name = l.contact?.name || formatPhone(l.contact?.phone || '');
            const summary = (isAr ? l.summaryAr || l.summaryEn : l.summaryEn || l.summaryAr) || '';
            const href = l.conversationId
              ? `/conversations?conversationId=${encodeURIComponent(l.conversationId)}`
              : `/conversations?phone=${encodeURIComponent(l.contact?.phone ?? '')}`;
            const hot = l.status === 'HOT';
            return (
              <li key={l.id}>
                <Link href={href} className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-fast hover:bg-raised/70">
                  <Avatar name={name} contactId={l.contact?.id} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {name.startsWith('+') ? <span dir="ltr">{name}</span> : <bdi>{name}</bdi>}
                      </p>
                      <span className={cn('chip', hot ? 'chip-danger' : 'chip-brand')}>{tLeads(`status.${l.status}`, { defaultValue: l.status })}</span>
                    </div>
                    {summary && <p className="mt-0.5 truncate text-2xs text-ink-3"><bdi>{summary}</bdi></p>}
                  </div>
                  {/* Score as a short meter: the number for precision, the bar for a glance. */}
                  <div className="flex w-14 shrink-0 flex-col items-end gap-1">
                    <span className="text-xs font-semibold tabular-nums text-ink">{l.score}</span>
                    <span className="h-1 w-full overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line">
                      <span
                        className={cn('grow-x block h-full rounded-full', l.score >= 75 ? 'bg-red-500' : l.score >= 50 ? 'bg-amber-500' : 'bg-brand')}
                        style={{ width: `${Math.min(100, Math.max(4, l.score))}%` }}
                      />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
