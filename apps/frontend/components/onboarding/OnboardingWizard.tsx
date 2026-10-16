'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useChatOpen } from '@/stores/chat-open-store';

const STORAGE_KEY = 'crm_onboarding_dismissed';
const OPEN_KEY = 'crm_onboarding_open';

/** Progress ring for the collapsed pill. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 7, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] -rotate-90" aria-hidden="true">
      <circle cx="9" cy="9" r={r} className="fill-none stroke-line" strokeWidth="2.2" />
      <circle cx="9" cy="9" r={r} className="fill-none stroke-brand transition-[stroke-dashoffset] duration-slow ease-out" strokeWidth="2.2"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} />
    </svg>
  );
}

/**
 * First-run checklist. It used to open as a 320px card over the bottom of every
 * page until dismissed; it now rests as a small progress pill and opens on
 * demand, so it guides without covering the work. Hidden in the inbox, where
 * the corner belongs to the composer.
 */
export default function OnboardingWizard() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const pathname = usePathname();
  // Screens with their own bottom action bar (open chat, campaign wizard) hide
  // the nav through this flag; the floating checklist must not cover them either.
  const fullScreenTask = useChatOpen((st) => st.isOpen);

  const STEPS = [
    { id: 'connect_wa', title: t('onboarding.connectWa.title'), description: t('onboarding.connectWa.description'), href: '/settings' },
    { id: 'add_contact', title: t('onboarding.addContact.title'), description: t('onboarding.addContact.description'), href: '/contacts' },
    { id: 'send_message', title: t('onboarding.sendMessage.title'), description: t('onboarding.sendMessage.description'), href: '/conversations' },
    { id: 'create_automation', title: t('onboarding.createAutomation.title'), description: t('onboarding.createAutomation.description'), href: '/automations' },
  ];
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [completedSteps, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    try { setOpen(sessionStorage.getItem(OPEN_KEY) === '1'); } catch { /* ignore */ }

    async function checkProgress() {
      try {
        const [statusData, contactData, convData, autoData] = await Promise.all([
          api.get('/api/whatsapp/status').catch(() => ({ status: 'disconnected' })),
          api.get('/api/contacts').catch(() => []),
          api.get('/api/conversations').catch(() => []),
          api.get('/api/automations').catch(() => []),
        ]);

        const done = new Set<string>();
        if (statusData?.status === 'connected') done.add('connect_wa');
        if (Array.isArray(contactData) && contactData.length > 0) done.add('add_contact');
        if (Array.isArray(convData) && convData.length > 0) done.add('send_message');
        if ((Array.isArray(autoData?.rules) && autoData.rules.length > 0) ||
            (Array.isArray(autoData?.flows) && autoData.flows.length > 0) ||
            (Array.isArray(autoData) && autoData.length > 0)) {
          done.add('create_automation');
        }

        setCompleted(done);
        if (done.size < STEPS.length) setVisible(true);
      } catch { /* ignore */ }
    }

    void checkProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try { sessionStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible || fullScreenTask || pathname?.startsWith('/conversations')) return null;

  const done = completedSteps.size;
  const total = STEPS.length;

  return (
    <div className="fixed bottom-[calc(var(--bottom-nav-space)+12px)] end-3 z-40 flex flex-col items-end gap-2 sm:bottom-5 sm:end-5">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">{t('onboarding.title')}</p>
                <p className="text-2xs text-ink-3">{t('onboarding.stepsProgress', { done, total })}</p>
              </div>
              <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm text-2xs">
                {t('onboarding.dismiss')}
              </button>
            </div>
            <ol className="p-1.5">
              {STEPS.map((step) => {
                const complete = completedSteps.has(step.id);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      disabled={complete}
                      onClick={() => { setOpenPersist(false); router.push(step.href); }}
                      className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-start transition-colors enabled:hover:bg-raised"
                    >
                      <span className={cn(
                        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
                        complete ? 'border-brand bg-brand text-brand-fg' : 'border-line-strong',
                      )}>
                        {complete && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[13px]', complete ? 'text-ink-3 line-through decoration-ink-4' : 'font-medium text-ink')}>{step.title}</span>
                        {!complete && <span className="mt-0.5 block text-2xs leading-4 text-ink-3">{step.description}</span>}
                      </span>
                      {!complete && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 icon-mirror" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpenPersist(!open)}
        aria-expanded={open}
        className="press flex h-9 items-center gap-2 rounded-full bg-surface ps-2.5 pe-3.5 text-xs font-semibold text-ink shadow-pop transition-colors hover:bg-raised"
      >
        {open ? <X className="h-[18px] w-[18px] text-ink-3" aria-hidden="true" /> : <Ring done={done} total={total} />}
        {t('onboarding.title')}
        <span className="tabular-nums text-ink-3">{done}/{total}</span>
      </button>
    </div>
  );
}
