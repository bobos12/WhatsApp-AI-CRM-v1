'use client';

import { useTranslation } from 'react-i18next';
import { Users, MessageSquare, Zap, MessageCircle, LucideIcon } from 'lucide-react';

interface StatsCardsProps {
  data: {
    totalContacts: number;
    openConversations: number;
    todayMessages: number;
    automationsFired: number;
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

interface CardDef {
  key: keyof StatsCardsProps['data'];
  labelKey: string;
  Icon: LucideIcon;
  accentBar: string;
  iconColor: string;
  iconBg: string;
  glow: string;
}

const CARDS: CardDef[] = [
  {
    key: 'totalContacts',
    labelKey: 'stats.totalContacts',
    Icon: Users,
    accentBar: 'bg-blue-500 dark:bg-blue-400',
    iconColor: 'text-blue-500 dark:text-blue-400',
    iconBg: 'bg-blue-500/10 border-blue-500/20 dark:bg-blue-400/10 dark:border-blue-400/20',
    glow: 'bg-blue-500/5 dark:bg-blue-400/10',
  },
  {
    key: 'openConversations',
    labelKey: 'stats.openConversations',
    Icon: MessageSquare,
    accentBar: 'bg-brand',
    iconColor: 'text-brand-strong dark:text-brand',
    iconBg: 'bg-brand/10 border-brand/20',
    glow: 'bg-brand/5 dark:bg-brand/10',
  },
  {
    key: 'todayMessages',
    labelKey: 'stats.messagesToday',
    Icon: MessageCircle,
    accentBar: 'bg-violet-500 dark:bg-violet-400',
    iconColor: 'text-violet-500 dark:text-violet-400',
    iconBg: 'bg-violet-500/10 border-violet-500/20 dark:bg-violet-400/10 dark:border-violet-400/20',
    glow: 'bg-violet-500/5 dark:bg-violet-400/10',
  },
  {
    key: 'automationsFired',
    labelKey: 'stats.automationsFired',
    Icon: Zap,
    accentBar: 'bg-orange-500 dark:bg-orange-400',
    iconColor: 'text-orange-500 dark:text-orange-400',
    iconBg: 'bg-orange-500/10 border-orange-500/20 dark:bg-orange-400/10 dark:border-orange-400/20',
    glow: 'bg-orange-500/5 dark:bg-orange-400/10',
  },
];

export default function StatsCards({ data }: StatsCardsProps) {
  const { t } = useTranslation('dashboard');

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARDS.map(({ key, labelKey, Icon, accentBar, iconColor, iconBg, glow }) => (
        <div
          key={key}
          className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-transparent dark:bg-raised dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
        >
          {/* Top color accent bar */}
          <div className={`absolute inset-x-0 top-0 h-[2px] rounded-t-2xl ${accentBar}`} />

          {/* Bottom-right ambient glow */}
          <div className={`pointer-events-none absolute -bottom-6 -end-6 h-24 w-24 rounded-full blur-2xl ${glow}`} />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">
                {t(labelKey)}
              </p>
              <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-ink">
                {fmt(data[key])}
              </p>
            </div>
            <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border ${iconBg}`}>
              <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
