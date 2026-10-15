'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'motion/react';
import { Search, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveCounts } from '../../hooks/useLiveCounts';
import { useLeadAlerts } from '../../hooks/useLeadAlerts';
import { useOperatorAccess } from '../../hooks/useOperatorAccess';
import { isManager } from '../../lib/roles';
import SidebarConnect from '../whatsapp/SidebarConnect';
import NotificationBell from '../notifications/NotificationBell';
import AccountMenu from './AccountMenu';
import { visibleGroups, isActive, type NavItem, type LiveKey } from './nav-config';
import { openCommandPalette } from './CommandPalette';

const COLLAPSE_KEY = 'nx-sidebar-collapsed';

/**
 * The sidebar is the product's signature surface: dark in both themes, so the
 * workspace beside it reads as paper on a desk. Full width (240px) on large
 * screens, an icon rail (64px) on tablets — and on large screens the user can
 * choose the rail too, for more room in the inbox.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useTranslation('sidebar');
  const reduceMotion = useReducedMotion();
  const { isOperator } = useOperatorAccess();
  const { openConversations } = useLiveCounts();
  const { needsAttention } = useLeadAlerts();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* storage blocked */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
      return !c;
    });
  };

  const role = (session?.user as { role?: string } | undefined)?.role;
  const groups = visibleGroups({ manager: isManager(role), operator: isOperator });
  const counts: Record<LiveKey, number | null> = {
    openConversations,
    leadsNeedsAttention: needsAttention,
  };

  // Label visibility: hidden on the tablet rail; on lg+ shown unless collapsed.
  const wide = !collapsed;
  const label = cn('hidden truncate', wide && 'lg:block');

  function Item({ item }: { item: NavItem }) {
    const active = isActive(pathname, item);
    const count = item.liveKey ? counts[item.liveKey] : null;
    const name = t(`nav.${item.key}`);
    return (
      <li>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          title={name}
          className={cn(
            'group relative flex h-9 items-center justify-center gap-3 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors duration-fast',
            'focus-visible:ring-2 focus-visible:ring-brand-400/60',
            wide && 'lg:justify-start',
            active ? 'text-nav-ink' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-ink',
          )}
        >
          {active && (
            <motion.span
              layoutId="nav-active"
              aria-hidden="true"
              className="absolute inset-0 rounded-lg bg-nav-hover ring-1 ring-inset ring-white/[0.06]"
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
            >
              <span className="absolute inset-y-2 start-0 w-[3px] rounded-e-full bg-brand-400" />
            </motion.span>
          )}
          <item.icon
            className={cn('relative h-[18px] w-[18px] shrink-0', active ? 'text-brand-400' : 'text-nav-muted group-hover:text-nav-ink')}
            strokeWidth={active ? 2.2 : 1.9}
            aria-hidden="true"
          />
          <span className={cn('relative flex-1', label)}>{name}</span>
          {typeof count === 'number' && count > 0 && (
            <>
              <span className={cn(
                'relative hidden min-w-[20px] rounded-md bg-white/[0.08] px-1.5 py-px text-center text-2xs font-semibold tabular-nums text-nav-ink',
                wide && 'lg:inline-block',
              )}>
                {count > 99 ? '99+' : count}
              </span>
              {/* Rail mode: the count collapses to a dot on the icon. */}
              <span className={cn('absolute end-2 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-400', wide && 'lg:hidden')} aria-hidden="true" />
            </>
          )}
        </Link>
      </li>
    );
  }

  return (
    <aside
      className={cn(
        'relative hidden w-16 shrink-0 flex-col border-e border-nav-line bg-nav sm:flex',
        'transition-[width] duration-base ease-out',
        wide && 'lg:w-60',
      )}
    >
      {/* Brand + notifications */}
      <div className={cn('flex h-14 items-center justify-center gap-2.5 px-3', wide && 'lg:justify-start lg:px-4')}>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label={t('appName')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-tight.png" alt="" className="h-7 w-7 shrink-0" />
          <span className={cn('min-w-0 leading-none', label)}>
            <span className="block text-[15px] font-semibold tracking-[-0.01em] text-nav-ink">{t('appName')}</span>
            <span className="mt-1 block text-2xs text-nav-muted">{t('appSubtitle')}</span>
          </span>
        </Link>
        <div className={cn('ms-auto hidden items-center gap-0.5', wide && 'lg:flex')}>
          <NotificationBell placement="nav" />
          <button type="button" onClick={toggleCollapsed} aria-label={t('collapse')} title={t('collapse')} className="flex h-8 w-8 items-center justify-center rounded-lg text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-ink">
            <PanelLeftClose className="h-4 w-4 icon-mirror" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Rail: notifications and the expand toggle stack under the logo. */}
      <div className={cn('flex flex-col items-center gap-1 pb-2', wide && 'lg:hidden')}>
        {collapsed && (
          <button type="button" onClick={toggleCollapsed} aria-label={t('expand')} title={t('expand')} className="hidden h-8 w-8 items-center justify-center rounded-lg text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-ink lg:flex">
            <PanelLeftOpen className="h-4 w-4 icon-mirror" aria-hidden="true" />
          </button>
        )}
        <NotificationBell placement="nav" />
      </div>

      {/* Search / command palette */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openCommandPalette}
          title={t('search')}
          className={cn(
            'flex h-9 w-full items-center justify-center gap-2.5 rounded-lg border border-nav-line bg-white/[0.03] px-2.5 text-[13px] text-nav-muted',
            'transition-colors hover:border-white/15 hover:text-nav-ink',
            wide && 'lg:justify-start',
          )}
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={cn('flex-1 text-start', label)}>{t('search')}</span>
          <kbd className={cn('hidden rounded border border-nav-line px-1 font-mono text-[10px] text-nav-muted', wide && 'lg:inline')}>⌘K</kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 scrollbar-none" aria-label="Main">
        {groups.map((group, gi) => (
          <div key={group.key} className={cn(gi > 0 && 'mt-5')}>
            {gi > 0 && (
              <>
                <p className={cn('mb-1.5 px-2.5 text-2xs font-medium uppercase tracking-[0.08em] text-nav-muted/80', label)}>
                  {t(`groups.${group.key}`)}
                </p>
                <div className={cn('mx-auto mb-2 h-px w-6 bg-nav-line', wide && 'lg:hidden')} aria-hidden="true" />
              </>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => <Item key={item.key} item={item} />)}
            </ul>
          </div>
        ))}
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent('toggle-crm-assistant'))}
          title={t('askAi')}
          className={cn(
            'mt-5 flex h-9 w-full items-center justify-center gap-3 rounded-lg px-2.5 text-[13px] font-medium text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-ink',
            wide && 'lg:justify-start',
          )}
        >
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-brand-400" strokeWidth={1.9} aria-hidden="true" />
          <span className={cn('flex-1 text-start', label)}>{t('askAi')}</span>
        </button>
      </nav>

      {/* Footer: connection, account */}
      <div className="space-y-1 border-t border-nav-line p-3">
        <SidebarConnect compact={wide ? 'below-lg' : true} />
        <AccountMenu variant="nav" compact={wide ? 'below-lg' : true} />
      </div>
    </aside>
  );
}
