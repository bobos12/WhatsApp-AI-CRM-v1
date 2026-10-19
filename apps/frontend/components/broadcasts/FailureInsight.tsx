'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const KEY = 'broadcasts.failureInsight';
interface Pref { collapsed: boolean; dismissedAt: number }

function readPref(): Pref {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { collapsed: false, dismissedAt: 0, ...JSON.parse(raw) };
  } catch { /* private mode / blocked storage — fall back to shown */ }
  return { collapsed: false, dismissedAt: 0 };
}

function writePref(p: Pref) {
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* best effort */ }
}

/**
 * Why campaign messages failed. Collapsible, and closable — closing hides it
 * until the failure count grows, so new failures are never silently missed.
 */
export default function FailureInsight({ failed }: { failed: number }) {
  const { t } = useTranslation('broadcasts');
  const [pref, setPref] = useState<Pref | null>(null);
  useEffect(() => { setPref(readPref()); }, []);

  const update = (patch: Partial<Pref>) => setPref((p) => {
    const next = { ...(p ?? readPref()), ...patch };
    writePref(next);
    return next;
  });

  if (!pref || failed <= pref.dismissedAt) return null;
  const open = !pref.collapsed;

  return (
    <section className="enter rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/[0.07]">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
          <Info className="h-4 w-4" aria-hidden="true" />
        </span>
        <button
          type="button"
          onClick={() => update({ collapsed: open })}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
        >
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {t('failureInsight.title', { count: failed })}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-amber-700 transition-transform duration-200 dark:text-amber-300', !open && '-rotate-90 rtl:rotate-90')}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => update({ dismissedAt: failed })}
          aria-label={t('failureInsight.dismiss')}
          title={t('failureInsight.dismiss')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 ps-[60px]">
              <p className="text-[13px] text-amber-800/90 dark:text-amber-300/80">{t('failureInsight.intro')}</p>
              <ul className="mt-2 space-y-1 text-[13px] text-amber-800/90 dark:text-amber-300/80">
                {['reasonNotOnWhatsapp', 'reasonWarmup', 'reasonDisconnected', 'reasonInvalid'].map((k) => (
                  <li key={k} className="flex gap-2">
                    <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                    <span>{t(`failureInsight.${k}`)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[13px] font-medium text-amber-900 dark:text-amber-200">{t('failureInsight.tip')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
