'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { Moon, Globe, RefreshCw, RotateCw, LogOut, Settings, ChevronsUpDown, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useLanguage } from '@/components/providers/I18nProvider';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { hardRefresh } from '@/lib/hard-refresh';
import { toSimpleRole } from '@/lib/roles';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import { Switch } from '@/components/ui/page';

/**
 * The account control: who you are, plus the per-person preferences (theme,
 * language) and the two escape hatches (sync, reload). It used to be spread over
 * five header icons; it is one menu now, because none of these is used often
 * enough to deserve permanent space.
 */
export default function AccountMenu({
  variant,
  compact = false,
}: {
  /** `nav` sits in the dark sidebar; `bar` sits in the light mobile header. */
  variant: 'nav' | 'bar';
  /** Rail mode, avatar only: always, or only below the lg breakpoint (tablet rail). */
  compact?: boolean | "below-lg";
}) {
  const railAlways = compact === true;
  const railBelowLg = compact === "below-lg";
  // Opens upward from the sidebar footer and the mobile sheet; downward from the top bar.
  const up = variant === "nav" || !railAlways;
  const { data: session } = useSession();
  const { t } = useTranslation('sidebar');
  const { t: tCommon } = useTranslation('common');
  const { theme, toggle } = useTheme();
  const { language, setLanguage } = useLanguage();
  const { syncing, sync } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const user = session?.user as { name?: string; email?: string; role?: string } | undefined;
  const name = user?.name || user?.email || '—';
  const email = user?.email || '';
  const { isOwner } = useOperatorAccess();
  const role = isOwner ? 'PLATFORM_OWNER' : toSimpleRole(user?.role);
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menu')}
        title={compact ? name : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg text-start transition-colors',
          variant === 'nav'
            ? cn('p-1.5 hover:bg-nav-hover', open && 'bg-nav-hover', (railAlways || railBelowLg) && 'justify-center', railBelowLg && 'lg:justify-start')
            : 'min-h-[56px] rounded-xl px-2.5 py-2 hover:bg-raised active:bg-raised',
        )}
      >
        <span className={cn(
          'flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          variant === 'nav' ? 'h-7 w-7 bg-brand-500/20 text-brand-300' : 'h-10 w-10 bg-brand/12 text-sm text-brand',
        )}>
          {initials}
        </span>
        {!railAlways && (
          <>
            <span className={cn("min-w-0 flex-1 leading-tight", railBelowLg && "hidden lg:block")}>
              <span className={cn('block truncate font-medium', variant === 'nav' ? 'text-[13px] text-nav-ink' : 'text-[15px] text-ink')}>{name}</span>
              <span className={cn(
                'flex items-center gap-1 truncate',
                variant === 'nav' ? 'text-2xs' : 'mt-0.5 text-xs',
                isOwner ? 'font-semibold text-amber-500 dark:text-amber-400' : variant === 'nav' ? 'text-nav-muted' : 'text-ink-3',
              )}>
                {isOwner && <Crown className="h-3 w-3 shrink-0" aria-hidden="true" />}
                {tCommon(`roles.${role}`)}
              </span>
            </span>
            <ChevronsUpDown className={cn('shrink-0', variant === 'nav' ? 'h-3.5 w-3.5' : 'h-4 w-4', variant === 'nav' ? 'text-nav-muted' : 'text-ink-4', railBelowLg && 'hidden lg:block')} aria-hidden="true" />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 4 : -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'absolute z-50 w-64 rounded-xl bg-surface p-1 shadow-pop',
              variant === 'nav'
                ? (railAlways ? 'bottom-0 start-[calc(100%+8px)]'
                  : railBelowLg ? 'bottom-0 start-[calc(100%+8px)] lg:bottom-[calc(100%+6px)] lg:start-0'
                  : 'bottom-[calc(100%+6px)] start-0')
                : railAlways ? 'end-0 top-[calc(100%+6px)]' : 'inset-x-0 bottom-[calc(100%+6px)] w-auto',
            )}
          >
            <div className="px-2.5 pb-2 pt-1.5">
              <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
              {email && <p className="truncate text-2xs text-ink-3">{email}</p>}
            </div>
            <div className="my-1 h-px bg-line" />
            <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Settings className="h-4 w-4 text-ink-3" aria-hidden="true" />
              {t('account.settings')}
            </Link>
            <div className={cn(item, 'cursor-default justify-between hover:bg-transparent')}>
              <span className="flex items-center gap-2.5">
                <Moon className="h-4 w-4 text-ink-3" aria-hidden="true" />
                {t('account.theme')}
              </span>
              <Switch size="sm" checked={theme === 'dark'} onChange={toggle} label={t('account.theme')} />
            </div>
            <button type="button" role="menuitem" onClick={() => { setLanguage(language === 'en' ? 'ar' : 'en'); setOpen(false); }} className={item}>
              <Globe className="h-4 w-4 text-ink-3" aria-hidden="true" />
              <span className="flex-1 text-start">{language === 'en' ? 'العربية' : 'English'}</span>
              <span className="kbd">{language === 'en' ? 'AR' : 'EN'}</span>
            </button>
            <div className="my-1 h-px bg-line" />
            <button type="button" role="menuitem" onClick={() => sync()} disabled={syncing} className={cn(item, 'disabled:opacity-60')}>
              <RefreshCw className={cn('h-4 w-4 text-ink-3', syncing && 'animate-spin')} aria-hidden="true" />
              {syncing ? tCommon('header.syncing') : t('account.sync')}
            </button>
            <button type="button" role="menuitem" onClick={() => { void hardRefresh(); }} className={item}>
              <RotateCw className="h-4 w-4 text-ink-3" aria-hidden="true" />
              {t('account.refresh')}
            </button>
            <div className="my-1 h-px bg-line" />
            <button type="button" role="menuitem" onClick={() => signOut()} className={cn(item, 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10')}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('account.signOut')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
