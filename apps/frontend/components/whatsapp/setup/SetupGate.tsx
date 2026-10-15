'use client';

/**
 * Nothing in the CRM works until WhatsApp is connected — the inbox, contacts,
 * templates and campaigns all run through the number. So instead of a dashboard
 * full of empty states and failing requests, a workspace without a number gets
 * one screen with one job:
 *
 *   - a manager sees the guided setup, full screen;
 *   - an employee sees that a manager has to connect it, and is let in
 *     automatically the moment that happens.
 *
 * A number that was connected and has since broken does NOT lock anyone out:
 * the team keeps their history and the banner/settings explain the fix.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Hourglass, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { isManager } from '@/lib/roles';
import LanguageSwitcher from '@/components/ui/LanguageSwitcher';
import ImpersonationBanner from '@/components/layout/ImpersonationBanner';
import { useWhatsAppConnection } from '../WhatsAppConnectProvider';
import SetupWizard from './SetupWizard';

const WAITING_POLL_MS = 15_000;

export default function SetupGate({ children }: { children: ReactNode }) {
  const { loaded, unreachable, configured, tenantless, refresh } = useWhatsAppConnection();
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  // Stays true from "Connect" until the person clicks through, so the success
  // screen isn't yanked away the instant the server reports `configured`.
  const [inSetup, setInSetup] = useState(false);

  if (tenantless) return <>{children}</>;
  if (sessionStatus === 'loading' || (!loaded && !unreachable)) return <Splash />;
  // Status couldn't be read at all. Locking people out on a network blip would be
  // worse than showing the app; the connection banner reports the problem.
  if (!loaded) return <>{children}</>;

  if (!configured || inSetup) {
    return isManager(role) ? (
      <SetupScreen
        onConnecting={() => setInSetup(true)}
        onFinish={async () => {
          await refresh();
          setInSetup(false);
        }}
      />
    ) : (
      <WaitingForAdmin onCheck={refresh} />
    );
  }

  return <>{children}</>;
}

// ── Screens ──────────────────────────────────────────────────────────────────

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('whatsapp');
  const { t: tNav } = useTranslation('sidebar');
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-canvas">
      {/* An operator viewing a client that isn't set up still needs the way back. */}
      <ImpersonationBanner />
      {/* A single soft wash of the brand colour behind the header — enough to say
          "this is the start of something", not enough to decorate. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgb(var(--brand)/0.10),transparent)]" />
      <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-tight.png" alt="" className="h-7 w-7 shrink-0" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{tNav('appName')}</span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="btn btn-ghost btn-sm">
            <LogOut className="icon-mirror" aria-hidden="true" />
            <span className="hidden sm:inline">{t('setup.signOut')}</span>
          </button>
        </div>
      </header>
      <main className="relative mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}

function SetupScreen({ onConnecting, onFinish }: { onConnecting: () => void; onFinish: () => void }) {
  const { t } = useTranslation('whatsapp');
  const why = t('setup.why.items', { returnObjects: true }) as string[];
  return (
    <Frame>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-14">
        <aside className="enter lg:pt-2">
          <p className="eyebrow">{t('setup.eyebrow')}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[28px] sm:leading-9">
            {t('setup.title')}
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-2">{t('setup.subtitle')}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-3">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {t('setup.time')}
          </p>
          <div className="mt-8 hidden border-t border-line pt-6 lg:block">
            <p className="text-xs font-semibold text-ink-2">{t('setup.why.title')}</p>
            <ul className="mt-3 space-y-2.5">
              {why.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13px] leading-5 text-ink-3">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="enter rounded-2xl border border-line bg-surface p-5 shadow-pop sm:p-7" style={{ animationDelay: '60ms' }}>
          <SetupWizard onConnecting={onConnecting} onFinish={onFinish} />
        </section>
      </div>
    </Frame>
  );
}

function WaitingForAdmin({ onCheck }: { onCheck: () => Promise<void> }) {
  const { t } = useTranslation('whatsapp');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => void onCheck(), WAITING_POLL_MS);
    return () => clearInterval(timer);
  }, [onCheck]);

  const check = async () => {
    setChecking(true);
    try { await onCheck(); } finally { setChecking(false); }
  };

  return (
    <Frame>
      <div className="enter mx-auto mt-6 max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-pop sm:mt-16">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-raised ring-1 ring-line">
          <Hourglass className="h-5 w-5 text-ink-2" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-ink">{t('waiting.title')}</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-2">{t('waiting.body')}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={check} disabled={checking} className="btn btn-primary">
            {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {checking ? t('waiting.checking') : t('waiting.checkAgain')}
          </button>
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="btn btn-ghost">
            {t('waiting.signOut')}
          </button>
        </div>
        <p className="mt-5 inline-flex items-center gap-2 text-2xs text-ink-4">
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
          </span>
          {t('waiting.auto')}
        </p>
      </div>
    </Frame>
  );
}

/**
 * Shown while the first status read is in flight. On a free host that sleeps,
 * that read can take most of a minute — so after a few seconds it says why,
 * rather than looking frozen.
 */
function Splash() {
  const { t } = useTranslation('whatsapp');
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-canvas px-6" role="status" aria-live="polite">
      <div className="flex max-w-xs flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/logo-tight.png" alt="" className="h-10 w-10 animate-pulse-slow motion-reduce:animate-none" />
        <Loader2 className="mt-5 h-4 w-4 animate-spin text-ink-3" aria-hidden="true" />
        <p className="mt-3 text-[13px] text-ink-2">{t('gate.loading')}</p>
        {slow && <p className="enter mt-2 text-xs leading-5 text-ink-3">{t('gate.waking')}</p>}
      </div>
    </div>
  );
}
