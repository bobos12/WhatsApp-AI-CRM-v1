'use client';

import { useEffect, useState } from 'react';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
const SEEN_KEY = 'nx-build';
const CHECK_EVERY_MS = 5 * 60 * 1000;
const UPDATED_FOR_MS = 8000;

/**
 * - latest  — this is the newest deploy
 * - updated — first open after a new deploy (shown for a few seconds)
 * - stale   — a newer deploy is live; the update banner offers a refresh
 */
export type AppVersionState = 'latest' | 'updated' | 'stale';

export function buildDate(locale: string): string {
  const d = new Date(BUILD);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function useAppVersion(): AppVersionState {
  const [state, setState] = useState<AppVersionState>('latest');

  useEffect(() => {
    if (!BUILD) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const seen = window.localStorage.getItem(SEEN_KEY);
      window.localStorage.setItem(SEEN_KEY, BUILD);
      if (seen && seen !== BUILD) {
        setState('updated');
        timer = setTimeout(() => setState((s) => (s === 'updated' ? 'latest' : s)), UPDATED_FOR_MS);
      }
    } catch { /* private mode */ }

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const { id } = (await res.json()) as { id: string | null };
        if (id && id !== BUILD) {
          setState('stale');
          // Reuse the existing "A new version is ready" banner.
          window.__swUpdateAvailable = true;
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      } catch { /* offline — try again later */ }
    };
    void check();
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(check, CHECK_EVERY_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return state;
}
