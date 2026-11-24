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
  const cell = 'press relative flex h-[52px] flex-1 select-none flex-col items-center justify-center gap-[3px] rounded-full';

  /** The active tab sits in a recessed pill that glides between tabs. */
  function Pill({ active }: { active: boolean }) {
    if (!active) return null;
    return (
      <motion.span
        layoutId="tab-pill"
        className="absolute inset-0 rounded-full bg-black/[0.07] dark:bg-[#121212]/90"
        transition={spring}
        aria-hidden="true"
      />
    );
  }

  function Glyph({ Icon, active, badge }: { Icon: LucideIcon; active: boolean; badge?: number }) {
    return (
      <span className="relative flex h-6 items-center justify-center">
        <Icon
          className="relative h-[23px] w-[23px] text-ink"
          strokeWidth={active ? 2.1 : 1.7}
          aria-hidden="true"
        />
        {!!badge && badge > 0 && (
          <span className="absolute -top-1.5 start-[60%] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#25D366] px-1 text-[11px] font-semibold tabular-nums text-white dark:bg-[#21C063] dark:text-[#0A0A0A]">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
    );
  }
  const label = (active: boolean) => cn('relative text-[11px] leading-none text-ink', active ? 'font-semibold' : 'font-medium');

  return (
    <>
      {/* Floating glass island, as in WhatsApp for iOS: content scrolls beneath it. */}
      <nav
        className="glass-island fixed inset-x-5 bottom-[var(--island-bottom)] z-30 rounded-full p-1 sm:hidden"
        aria-label="Primary"
      >
        <div className="flex items-stretch gap-0.5">
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
                <Pill active={active} />
                <Glyph Icon={icon} active={active} badge={live ? openConversations ?? 0 : 0} />
                <span className={label(active)}>
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
            <Pill active={onMore} />
            <Glyph Icon={LayoutGrid} active={onMore} />
            <span className={label(onMore)}>{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
