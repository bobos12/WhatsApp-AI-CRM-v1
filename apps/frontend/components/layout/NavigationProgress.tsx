'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A thin line along the top edge while the next screen loads.
 *
 * Screens used to swap to a generic grey skeleton on every tap — the same boxes
 * whichever screen you were going to — which read as the whole page reloading.
 * Now the current screen stays exactly where it is and this line is the only
 * sign of loading, the way native apps and Gmail behave. On a fast connection it
 * finishes before it is noticed.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<'idle' | 'start' | 'loading' | 'done'>('idle');
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start on a click that leads to another in-app page.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (doneTimer.current) clearTimeout(doneTimer.current);
      setState('start');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Paint at a sliver first so the bar visibly grows rather than appearing half full.
  useEffect(() => {
    if (state !== 'start') return;
    const frame = requestAnimationFrame(() => setState('loading'));
    return () => cancelAnimationFrame(frame);
  }, [state]);

  // Finish when the new screen is showing.
  useEffect(() => {
    setState((s) => (s === 'loading' || s === 'start' ? 'done' : s));
    doneTimer.current = setTimeout(() => setState('idle'), 320);
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [pathname, searchParams]);

  if (state === 'idle') return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 z-[100] h-[2px]"
      style={{ top: 'env(safe-area-inset-top)' }}
    >
      <div
        className="h-full origin-left bg-brand rtl:origin-right"
        style={{
          transform: `scaleX(${state === 'done' ? 1 : state === 'start' ? 0.08 : 0.8})`,
          opacity: state === 'done' ? 0 : 1,
          transition:
            state === 'done'
              ? 'transform 160ms ease-out, opacity 200ms ease-out 120ms'
              : state === 'start'
                ? 'none'
                : 'transform 8s cubic-bezier(0.1, 0.7, 0.2, 1)',
        }}
      />
    </div>
  );
}
