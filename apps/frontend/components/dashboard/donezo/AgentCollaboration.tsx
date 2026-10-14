'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Users, Plus } from 'lucide-react';

interface AgentStat {
  agentId: string;
  name: string;
  email: string;
  openConversations: number;
  resolvedConversations: number;
  avgFirstResponseMin: number | null;
}

const AVATAR_COLORS = [
  'bg-brand/15 text-brand-strong dark:bg-brand/15 dark:text-brand',
  'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400',
  'bg-violet-500/15 text-violet-600 dark:bg-violet-400/15 dark:text-violet-400',
  'bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400',
  'bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-400',
] as const;

function statusFor(rate: number, t: (k: string) => string) {
  if (rate >= 80) return { label: t('collab.completed'), cls: 'bg-brand/12 text-brand-strong dark:bg-brand/12 dark:text-brand' };
  if (rate >= 40) return { label: t('collab.inProgress'), cls: 'bg-amber-400/15 text-amber-600 dark:bg-amber-400/12 dark:text-amber-400' };
  return { label: t('collab.pending'), cls: 'bg-rose-400/15 text-rose-600 dark:bg-rose-400/12 dark:text-rose-400' };
}

export default function AgentCollaboration({
  agents,
  isAdmin,
}: {
  agents: AgentStat[];
  isAdmin: boolean;
}) {
  const { t } = useTranslation('dashboard');

  return (
    <section className="flex h-full flex-col rounded-xl bg-white/80 backdrop-blur-xl border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-5 dark:bg-surface/90 dark:border-white/8 dark:shadow-[0_2px_20px_rgba(0,0,0,0.35)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-ink">{t('collab.title')}</h2>
        {isAdmin && (
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-brand dark:border-white/10 dark:text-ink-3 dark:hover:border-brand/40 dark:hover:bg-brand/10 dark:hover:text-brand"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('collab.manage')}
          </Link>
        )}
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised">
            <Users className="h-5 w-5 text-ink-4" aria-hidden="true" />
          </span>
          <p className="text-sm text-ink-3">{t('collab.empty')}</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-line">
          {agents.slice(0, 5).map((agent, i) => {
            const total = agent.openConversations + agent.resolvedConversations;
            const rate = total > 0 ? Math.round((agent.resolvedConversations / total) * 100) : 0;
            const initials = agent.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
            const st = statusFor(rate, t);

            return (
              <li key={agent.agentId} className="flex items-center gap-3 py-2.5">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`} aria-hidden="true">
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{agent.name}</p>
                  <p className="truncate text-[11px] text-ink-4">
                    <span className="text-ink-4">{t('collab.workingOnPrefix')} </span>
                    <span className="text-gray-500 dark:text-gray-300">{t('collab.workingOn', { open: agent.openConversations, resolved: agent.resolvedConversations })}</span>
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${st.cls}`}>
                  {st.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
