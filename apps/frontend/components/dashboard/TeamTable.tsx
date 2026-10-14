'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { avatarTone } from '@/components/ui/Avatar';
import { Panel, EmptyState } from '@/components/ui/page';
import type { AgentStat } from '@/stores/stats-store';

/**
 * Who is carrying what, and how fast they answer. A table, because these are
 * compared across rows — the old card list made that comparison by eye.
 */
export default function TeamTable({ agents, isAdmin, locale }: { agents: AgentStat[]; isAdmin: boolean; locale: string }) {
  const { t } = useTranslation('dashboard');
  const rows = [...agents].sort((a, b) => b.openConversations - a.openConversations).slice(0, 8);

  return (
    <Panel open
      title={t('today.team.title')}
      description={t('today.team.sub')}
      actions={isAdmin ? <Link href="/admin/users" className="btn btn-ghost btn-sm">{t('today.team.manage')}</Link> : undefined}
      className="h-full"
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={Users} title={t('today.team.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-2xs font-medium text-ink-3">
                <th className="px-4 py-2 font-medium">{t('today.team.agent')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('today.team.open')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('today.team.resolved')}</th>
                <th className="w-[28%] px-3 py-2 font-medium">{t('today.team.resolution')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('today.team.firstResponse')}</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((a) => {
                const total = a.openConversations + a.resolvedConversations;
                const rate = total > 0 ? Math.round((a.resolvedConversations / total) * 100) : 0;
                const initials = a.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
                const slow = a.avgFirstResponseMin != null && a.avgFirstResponseMin > 10;
                return (
                  <tr key={a.agentId} className="border-b border-line last:border-0 transition-colors hover:bg-raised/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', avatarTone(a.name.toLowerCase()))} aria-hidden="true">
                          {initials}
                        </span>
                        <span className="truncate font-medium text-ink">{a.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-end font-semibold tabular-nums text-ink">{formatNumber(a.openConversations, locale)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink-2">{formatNumber(a.resolvedConversations, locale)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line">
                          <span className="grow-x block h-full rounded-full bg-brand" style={{ width: `${rate}%` }} />
                        </span>
                        <span className="w-9 text-end text-2xs tabular-nums text-ink-3">{rate}%</span>
                      </div>
                    </td>
                    <td className={cn('px-4 py-2.5 text-end tabular-nums', slow ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-ink-2')}>
                      {a.avgFirstResponseMin == null ? '—' : t('today.team.min', { n: a.avgFirstResponseMin.toFixed(a.avgFirstResponseMin < 10 ? 1 : 0) })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
