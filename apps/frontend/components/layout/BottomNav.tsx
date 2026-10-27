'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { Home, MessageSquare, Users, Send, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { useLiveCounts } from '@/hooks/useLiveCounts';
import { useChatOpen } from '@/stores/chat-open-store';
import MobileDrawer from './MobileDrawer';

type Tab = { key: string; href: string; icon: LucideIcon; live?: boolean };

// Reading order: Home first. The bar follows the document direction, so in
// Arabic Home sits at the right edge — where an Arabic reader starts — exactly
// as the platform tab bars on iOS and Android mirror.
const TABS: readonly Tab[] = [
  { key: 'dashboard',     href: '/dashboard',     icon: Home },
  { key: 'conversations', href: '/conversations', icon: MessageSquare, live: true },
  { key: 'contacts',      href: '/contacts',      icon: Users },
  { key: 'broadcasts',    href: '/broadcasts',    icon: Send },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { openConversations } = useLiveCounts();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { t } = useTranslation('sidebar');
  const chatWindowOpen = useChatOpen((s) => s.isOpen);
  const reduceMotion = useReducedMotion();

  // A chat owns the whole screen on a phone — its composer sits where this bar
  // would. Full-screen editors hide the bar themselves via setNavHidden(true).
  if (chatWindowOpen) return null;

  // Any screen that isn't one of the four tabs lives under "More".
  const onMore = !TABS.some((tab) => pathname?.startsWith(tab.href));
  const spring = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 38 };
  const cell = 'press relative flex h-14 flex-1 select-none flex-col items-center justify-center gap-1';

  function Glyph({ Icon, active, badge }: { Icon: LucideIcon; active: boolean; badge?: number }) {
    return (
      <span className="relative flex h-7 w-12 items-center justify-center">
        {active && (
          <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-brand/12" transition={spring} aria-hidden="true" />
        )}
        <Icon
          className={cn('relative h-[19px] w-[19px] transition-colors duration-fast', active ? 'text-brand' : 'text-ink-3')}
          strokeWidth={active ? 2.3 : 1.9}
          aria-hidden="true"
        />
        {!!badge && badge > 0 && (
          <span className="absolute -top-1 end-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold tabular-nums text-brand-fg ring-2 ring-surface">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
    );
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[max(0.25rem,calc(env(safe-area-inset-bottom)-0.875rem))] backdrop-blur-md sm:hidden"
        aria-label="Primary"
      >
        <div className="flex items-stretch">
          {TABS.map(({ key, href, icon, live }) => {
            const active = !!pathname?.startsWith(href);
            return (
              <Link
                key={key}
                href={href}
                onClick={() => { if (!active) haptic('selection'); }}
                aria-current={active ? 'page' : undefined}
                className={cell}
              >
                <Glyph Icon={icon} active={active} badge={live ? openConversations ?? 0 : 0} />
                <span className={cn('text-[10px] font-medium leading-none transition-colors duration-fast', active ? 'text-ink' : 'text-ink-3')}>
                  {t(`nav.${key}`)}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => { haptic('selection'); setDrawerOpen(true); }}
            aria-label={t('nav.more')}
            aria-expanded={drawerOpen}
            className={cell}
          >
            <Glyph Icon={LayoutGrid} active={onMore} />
            <span className={cn('text-[10px] font-medium leading-none', onMore ? 'text-ink' : 'text-ink-3')}>{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
