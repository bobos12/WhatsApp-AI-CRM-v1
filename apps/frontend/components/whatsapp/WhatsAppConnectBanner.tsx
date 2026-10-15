'use client';

/**
 * A strip under the header when a connected number has stopped working — an
 * expired token, a revoked permission, a restricted account.
 *
 * Setting up a number for the first time is SetupGate's job, so this no longer
 * prompts to "connect". It says the connection broke and points to the health
 * check in Settings, which names the cause and carries the fix. Employees can't
 * change the connection, so they're told who can instead of shown a button that
 * would be refused.
 *
 * Minimizable to a slim line (remembered), and re-expanded on a fresh failure.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Stethoscope } from 'lucide-react';
import { isManager } from '../../lib/roles';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';

const MIN_KEY = 'wa_connect_banner_min';

export default function WhatsAppConnectBanner() {
  const { t } = useTranslation('whatsapp');
  const pathname = usePathname();
  const { data: session } = useSession();
  const canManage = isManager((session?.user as { role?: string } | undefined)?.role);
  const { status, configured, loaded, tenantless } = useWhatsAppConnection();

  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try { setMinimized(localStorage.getItem(MIN_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  const broken = loaded && !tenantless && configured && status === 'disconnected';

  // A new failure always gets the full strip, even if an older one was minimized.
  useEffect(() => {
    if (!broken) {
      try { localStorage.removeItem(MIN_KEY); } catch { /* ignore */ }
    }
  }, [broken]);

  const toggleMin = (next: boolean) => {
    setMinimized(next);
    try {
      if (next) localStorage.setItem(MIN_KEY, '1');
      else localStorage.removeItem(MIN_KEY);
    } catch { /* ignore */ }
  };

  // Settings already shows the health check this would link to.
  if (!broken || pathname?.startsWith('/settings')) return null;

  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-50 motion-reduce:hidden" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => toggleMin(false)}
        className="group flex h-8 w-full shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 text-start transition-colors hover:bg-raised sm:px-6"
      >
        {dot}
        <span className="flex-1 truncate text-xs font-medium text-ink-2">{t('banner.expand')}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4 icon-mirror" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div role="status" className="enter flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 sm:px-6">
      {dot}
      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
        {t('banner.brokenTitle')}
        <span className="ms-2 hidden font-normal text-ink-3 md:inline">
          {canManage ? t('banner.brokenBody') : t('banner.askManager')}
        </span>
      </p>
      {canManage && (
        <Link href="/settings?section=whatsapp" className="btn btn-primary btn-sm">
          <Stethoscope aria-hidden="true" />
          {t('banner.fix')}
        </Link>
      )}
      <button
        type="button"
        onClick={() => toggleMin(true)}
        aria-label={t('banner.collapse')}
        title={t('banner.collapse')}
        className="btn btn-ghost btn-icon btn-sm"
      >
        <ChevronDown aria-hidden="true" />
      </button>
    </div>
  );
}
