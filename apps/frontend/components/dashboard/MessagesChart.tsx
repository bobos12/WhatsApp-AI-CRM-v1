'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import { BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, type TooltipProps,
} from 'recharts';
import { useLanguage } from '../providers/I18nProvider';
import { localeFor, formatNumber } from '../../lib/format';
import { Panel, EmptyState } from '../ui/page';

interface MessagesChartProps {
  data: Array<{ date: string; incoming: number; outgoing: number }>;
}

function useIsDark() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

// SVG presentation attributes can't read CSS variables, so the chart takes
// literal colours — the same values the tokens resolve to in each theme.
const PALETTE = {
  light: { sent: '#128245', received: '#C9D1CD', grid: '#E9EDEB', tick: '#8A948F', cursor: 'rgba(17,23,20,0.04)' },
  dark:  { sent: '#2ECC74', received: '#36423C', grid: '#1E2622', tick: '#6E7873', cursor: 'rgba(255,255,255,0.04)' },
};

function ChartTooltip({ active, payload, label, locale }: TooltipProps<number, string> & { locale: string }) {
  const { t } = useTranslation('dashboard');
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="min-w-[160px] rounded-lg bg-surface px-3 py-2.5 shadow-pop">
      <p className="mb-2 text-2xs font-medium text-ink-3">
        {new Date(label).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })}
      </p>
      {payload.map((p) => (
        <div key={p.dataKey as string} className="flex items-center justify-between gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums text-ink">{formatNumber(Number(p.value) || 0, locale)}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between border-t border-line pt-1.5 text-2xs">
        <span className="text-ink-3">{t('today.activity.total')}</span>
        <span className="font-semibold tabular-nums text-ink">{formatNumber(total, locale)}</span>
      </div>
    </div>
  );
}

export default function MessagesChart({ data }: MessagesChartProps) {
  const { t } = useTranslation('dashboard');
  const { language } = useLanguage();
  const locale = localeFor(language);
  const isDark = useIsDark();
  const reduce = useReducedMotion();
  const c = isDark ? PALETTE.dark : PALETTE.light;

  // The server returns exactly the requested window, zero-filled, so every bar
  // is a real day. It used to omit days with no traffic and the client took the
  // last 7 rows — on a quiet account "the last 7 days" silently spanned weeks.
  const totalOutgoing = data.reduce((s, d) => s + d.outgoing, 0);
  const totalIncoming = data.reduce((s, d) => s + d.incoming, 0);
  const hasActivity = totalOutgoing + totalIncoming > 0;

  const legend = (
    <div className="flex items-center gap-4">
      {[
        { label: t('today.activity.sent'), value: totalOutgoing, color: c.sent },
        { label: t('today.activity.received'), value: totalIncoming, color: c.received },
      ].map((l) => (
        <div key={l.label} className="flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} aria-hidden="true" />
          <span className="text-ink-3">{l.label}</span>
          <span className="font-semibold tabular-nums text-ink">{formatNumber(l.value, locale)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <Panel open title={t('today.activity.title')} description={t('today.activity.sub')} actions={<div className="hidden sm:block">{legend}</div>} className="h-full">
      {!hasActivity ? (
        <EmptyState compact icon={BarChart3} title={t('today.activity.empty')} />
      ) : (
        <div className="px-2 pb-3 pt-4 sm:px-4">
          <div className="mb-3 px-2 sm:hidden">{legend}</div>
          <div className="h-[280px]" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={3} barCategoryGap="24%">
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: c.tick, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  reversed={language === 'ar'}
                  tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { weekday: 'short' })}
                />
                <YAxis
                  tick={{ fill: c.tick, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={44}
                  orientation={language === 'ar' ? 'right' : 'left'}
                />
                <Tooltip content={<ChartTooltip locale={locale} />} cursor={{ fill: c.cursor, radius: 6 }} />
                <Bar dataKey="outgoing" name={t('today.activity.sent')} fill={c.sent} radius={[3, 3, 0, 0]} maxBarSize={26}
                  isAnimationActive={!reduce} animationDuration={700} animationEasing="ease-out" />
                <Bar dataKey="incoming" name={t('today.activity.received')} fill={c.received} radius={[3, 3, 0, 0]} maxBarSize={26}
                  isAnimationActive={!reduce} animationDuration={700} animationBegin={120} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}
