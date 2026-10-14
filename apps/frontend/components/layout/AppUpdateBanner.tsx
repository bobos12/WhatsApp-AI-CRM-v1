'use client';

/**
 * AppUpdateBanner — surfaces a waiting service-worker update inside the actual
 * dashboard shell (the SW registration in app/layout.tsx dispatches
 * `sw-update-available`, but nothing previously listened for it here, so a
 * stale worker could keep controlling a tab indefinitely and users had no way
 * to know a refresh would fix things). Tapping it activates the new worker,
 * clears Cache Storage, and reloads — auth cookies/tokens are untouched.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { hardRefresh } from '@/lib/hard-refresh';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    __swUpdateAvailable?: boolean;
  }
}

export default function AppUpdateBanner() {
  const { t } = useTranslation('common');
  const [available, setAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.__swUpdateAvailable) setAvailable(true);
    const handler = () => setAvailable(true);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);

  if (!available) return null;

  const onUpdate = () => {
    if (updating) return;
    setUpdating(true);
    void hardRefresh();
  };

  return (
    <div className="enter flex shrink-0 items-center gap-3 border-b border-line bg-brand-soft px-4 py-2 sm:px-6">
      <RefreshCw className={cn('h-4 w-4 shrink-0 text-brand', updating && 'animate-spin')} aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
        {updating ? t('appUpdate.updating') : t('appUpdate.title')}
        {!updating && <span className="ms-2 hidden font-normal text-ink-3 md:inline">{t('appUpdate.body')}</span>}
      </p>
      {!updating && (
        <button type="button" onClick={onUpdate} className="btn btn-primary btn-sm">{t('appUpdate.action')}</button>
      )}
    </div>
  );
}
