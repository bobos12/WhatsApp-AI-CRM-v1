'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Users, MessageSquare, MessageCircle, Flame, ArrowUpRight, TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react';
import { useLanguage } from '../../providers/I18nProvider';
import type { OverviewData } from '../../../stores/stats-store';

type Direction = 'up' | 'down' | 'flat';

interface Caption {
  text: string;
  direction: Direction;
}

type Translate = (key: string, opts?: Record<string, unknown>) => string;

interface CardDef {
  key: 'totalContacts' | 'openConversations' | 'todayMessages' | 'hotLeads';
  labelKey: string;
  href: string;
  Icon: LucideIcon;
  accentGradient: string;
  iconBg: string;
  iconColor: string;
  glowColor: string;
  trendColor: string;
  /**
   * The line under the number. Every card states something the API actually
   * measured — these used to be fixed strings ("Across your whole audience")
   * beside a hard-coded up-arrow, which reads as growth nobody computed.
   */
  caption: (d: OverviewData, t: Translate, locale: string) => Caption;
}

const n = (v: number, locale: string) => v.toLocaleString(locale);

const CARDS: CardDef[] = [
  {
    key: 'totalContacts',
    labelKey: 'kpi.totalContacts',
    href: '/contacts',
    Icon: Users,
    accentGradient: 'from-blue-500 to-blue-400',
    iconBg: 'bg-blue-50 border-blue-200/60 dark:bg-blue-400/10 dark:border-blue-400/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    glowColor: 'bg-blue-400/10 dark:bg-blue-400/8',
    trendColor: 'text-blue-500 dark:text-blue-400',
    caption: (d, t, locale) => d.newContactsToday > 0
      ? { text: t('kpi.newToday', { count: n(d.newContactsToday, locale) }), direction: 'up' }
      : { text: t('kpi.noneToday'), direction: 'flat' },
  },
  {
    key: 'openConversations',
    labelKey: 'kpi.openConversations',
    href: '/conversations',
    Icon: MessageSquare,
    accentGradient: 'from-brand to-brand-strong',
    iconBg: 'bg-brand/10 border-brand/25',
    iconColor: 'text-brand dark:text-brand',
    glowColor: 'bg-brand/10 dark:bg-brand/8',
    trendColor: 'text-brand dark:text-brand',
    caption: (d, t, locale) => d.unansweredConversations > 0
      ? { text: t('kpi.unread', { count: n(d.unansweredConversations, locale) }), direction: 'up' }
      : { text: t('kpi.allRead'), direction: 'flat' },
  },
  {
    key: 'todayMessages',
    labelKey: 'kpi.todayMessages',
    href: '/conversations',
    Icon: MessageCircle,
    accentGradient: 'from-violet-500 to-violet-400',
    iconBg: 'bg-violet-50 border-violet-200/60 dark:bg-violet-400/10 dark:border-violet-400/20',
    iconColor: 'text-violet-600 dark:text-violet-400',
    glowColor: 'bg-violet-400/10 dark:bg-violet-400/8',
    trendColor: 'text-violet-500 dark:text-violet-400',
    caption: (d, t, locale) => {
      // Deliberately compared against yesterday's FULL day, not the same hour of
      // it. Stated plainly in the copy so a morning reading of "-60%" is not
      // mistaken for a collapse in volume.
      if (d.todayMessages === 0 && d.yesterdayMessages === 0) {
        return { text: t('kpi.noMessagesToday'), direction: 'flat' };
      }
      if (d.yesterdayMessages === 0) {
        return { text: t('kpi.vsYesterdayNoBase', { count: n(d.todayMessages, locale) }), direction: 'up' };
      }
      const pct = Math.round(((d.todayMessages - d.yesterdayMessages) / d.yesterdayMessages) * 100);
      if (pct === 0) return { text: t('kpi.sameAsYesterday'), direction: 'flat' };
      return {
        text: t('kpi.vsYesterday', { percent: n(Math.abs(pct), locale), sign: pct > 0 ? '+' : '−' }),
        direction: pct > 0 ? 'up' : 'down',
      };
    },
  },
  {
    key: 'hotLeads',
    labelKey: 'kpi.hotLeads',
    href: '/leads',
    Icon: Flame,
    accentGradient: 'from-red-500 to-orange-400',
    iconBg: 'bg-red-50 border-red-200/60 dark:bg-red-400/10 dark:border-red-400/20',
    iconColor: 'text-red-600 dark:text-red-400',
    glowColor: 'bg-red-400/10 dark:bg-red-400/8',
    trendColor: 'text-red-500 dark:text-red-400',
    caption: (d, t, locale) => d.hotLeadsToday > 0
      ? { text: t('kpi.hotToday', { count: n(d.hotLeadsToday, locale) }), direction: 'up' }
      : { text: t('kpi.noHotToday'), direction: 'flat' },
  },
];

const TREND_ICON: Record<Direction, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export default function KpiCards({ data }: { data: OverviewData }) {
  const { t } = useTranslation('dashboard');
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {CARDS.map((card) => {
        const value = data[card.key].toLocaleString(locale);
        const Icon = card.Icon;
        const caption = card.caption(data, t as Translate, locale);
        const TrendIcon = TREND_ICON[caption.direction];

        return (
          <Link
            key={card.key}
            href={card.href}
            className="group relative flex flex-col overflow-hidden rounded-xl bg-white/80 backdrop-blur-xl border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-4 sm:p-5 transition-all duration-200 hover:shadow-[0_8px_32px_rgba(0,0,0,0.10)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:bg-raised dark:border-transparent dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)]"
          >
            {/* Top gradient accent bar */}
            <div className={`absolute inset-x-0 top-0 h-[3px] rounded-t-[20px] bg-gradient-to-r ${card.accentGradient}`} />

            {/* Ambient glow */}
            <div className={`pointer-events-none absolute -bottom-8 -end-8 h-28 w-28 rounded-full blur-2xl ${card.glowColor}`} />

            {/* Label row */}
            <div className="relative flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">
                {t(card.labelKey)}
              </p>
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-all group-hover:scale-110 dark:border-white/10 dark:text-ink-3"
                aria-hidden="true"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>

            {/* Number + icon */}
            <div className="relative mt-3 flex items-end justify-between gap-3">
              <p className="text-[32px] sm:text-[42px] font-bold leading-none tabular-nums tracking-tight text-ink">
                {value}
              </p>
              <div className={`mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${card.iconBg}`}>
                <Icon className={`h-5 w-5 ${card.iconColor}`} aria-hidden="true" />
              </div>
            </div>

            {/* Caption — a measured number, and an arrow that matches its sign */}
            <div className="relative mt-3 flex items-center gap-1.5">
              <TrendIcon
                className={`h-3.5 w-3.5 shrink-0 ${
                  caption.direction === 'down'
                    ? 'text-ink-4'
                    : caption.direction === 'flat'
                      ? 'text-gray-300 dark:text-white/25'
                      : card.trendColor
                }`}
                aria-hidden="true"
              />
              <p className="text-[11px] font-medium text-ink-4">
                {caption.text}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
