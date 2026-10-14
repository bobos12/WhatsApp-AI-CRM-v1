'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MessageSquareReply } from 'lucide-react';
import { useLanguage } from '../../providers/I18nProvider';

export default function Reminders({ openCount }: { openCount: number }) {
  const { t } = useTranslation('dashboard');
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  const caughtUp = openCount === 0;

  return (
    <section className="flex h-full flex-col rounded-xl bg-white/80 backdrop-blur-xl border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-5 dark:bg-surface/90 dark:border-white/8 dark:shadow-[0_2px_20px_rgba(0,0,0,0.35)]">
      <h2 className="text-[15px] font-bold text-ink">{t('reminders.title')}</h2>

      <div className="mt-3 flex-1">
        <p className="text-[19px] font-bold leading-snug text-ink">
          {caughtUp
            ? t('reminders.caughtUp')
            : t('reminders.headline', { count: openCount.toLocaleString(locale) })}
        </p>
        <p className="mt-2 text-xs text-ink-3">
          {caughtUp ? t('reminders.caughtUpSub') : t('reminders.sub')}
        </p>
      </div>

      <Link
        href="/conversations"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:bg-brand dark:text-brand-fg dark:hover:bg-brand-strong"
      >
        <MessageSquareReply className="h-4 w-4" aria-hidden="true" />
        {t('reminders.action')}
      </Link>
    </section>
  );
}
