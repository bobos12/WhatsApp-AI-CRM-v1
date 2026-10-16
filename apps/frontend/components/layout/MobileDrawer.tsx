'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveCounts } from '@/hooks/useLiveCounts';
import { useLeadAlerts } from '@/hooks/useLeadAlerts';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import { isManager } from '@/lib/roles';
import AccountMenu from './AccountMenu';
import { visibleGroups, isActive, SETTINGS_ITEM, type LiveKey } from './nav-config';

// The four bottom-bar tabs aren't repeated here; this sheet is "everything else".
const ON_TAB_BAR = new Set(['dashboard', 'conversations', 'contacts', 'broadcasts']);

export default function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const { data: session } = useSession();
  const { t } = useTranslation('sidebar');
  const { isOperator } = useOperatorAccess();
  const { openConversations } = useLiveCounts();
  const { needsAttention } = useLeadAlerts();

  const role = (session?.user as { role?: string } | undefined)?.role;
  const counts: Record<LiveKey, number | null> = { openConversations, leadsNeedsAttention: needsAttention };
  const groups = visibleGroups({ manager: isManager(role), operator: isOperator })
    .map((g) => ({ ...g, items: g.items.filter((i) => !ON_TAB_BAR.has(i.key)) }))
    .filter((g) => g.items.length > 0);
  groups.push({ key: 'workspace', items: [SETTINGS_ITEM] } as (typeof groups)[number]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close when the route changes (a link was followed).
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            className="fixed inset-0 z-40 bg-[rgb(8_12_10/0.45)]"
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />

          {/* Bottom sheet — swipe down on the grip to dismiss; the list itself
              still scrolls because the drag only starts from the grip. */}
          <motion.div
            key="drawer-sheet"
            role="dialog"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] flex-col rounded-t-2xl bg-surface pb-safe shadow-pop"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 42 }}
            drag={reduceMotion ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose(); }}
          >
            <div className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5" onPointerDown={(e) => dragControls.start(e)}>
              <div className="h-1 w-9 rounded-full bg-line-strong" />
            </div>
            <div className="flex shrink-0 items-center justify-between px-4 pb-1">
              <p className="text-base font-semibold text-ink">{t('menu')}</p>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('closeSidebar')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-ink-2 transition-colors hover:bg-overlay hover:text-ink active:scale-95"
              >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {groups.map((group, gi) => (
                <div key={`${group.key}-${gi}`} className="mt-3 first:mt-1">
                  {group.items[0]?.key !== 'settings' && gi > 0 && (
                    <p className="eyebrow px-2 pb-1.5">{t(`groups.${group.key}`)}</p>
                  )}
                  <ul className="overflow-hidden rounded-xl border border-line">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item);
                      const count = item.liveKey ? counts[item.liveKey] : null;
                      return (
                        <li key={item.key} className="border-b border-line last:border-0">
                          <Link
                            href={item.href}
                            className={cn('flex h-12 items-center gap-3 px-3.5 transition-colors active:bg-raised', active && 'bg-raised')}
                          >
                            <item.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-brand' : 'text-ink-3')} aria-hidden="true" />
                            <span className={cn('flex-1 text-sm', active ? 'font-semibold text-ink' : 'font-medium text-ink')}>
                              {t(`nav.${item.key}`)}
                            </span>
                            {typeof count === 'number' && count > 0 && (
                              <span className="chip chip-brand tabular-nums">{count > 99 ? '99+' : count}</span>
                            )}
                            <ChevronRight className="h-4 w-4 shrink-0 text-ink-4 icon-mirror" aria-hidden="true" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="shrink-0 border-t border-line px-3 py-2.5 pb-safe">
              <AccountMenu variant="bar" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
