'use client';

import { useEffect } from 'react';
import socket from '../lib/socket';
import { useStatsStore, type StatsSection } from '../stores/stats-store';

/**
 * Keeps dashboard statistics live.
 *
 * The server is the only thing that counts (see stats-store.ts); a realtime
 * event just says "this section is stale". That costs one small request per
 * burst instead of being permanently, silently wrong.
 *
 * Four things can invalidate a section:
 *   - a realtime event that changes an underlying row,
 *   - the socket reconnecting (anything emitted while it was down was missed —
 *     the seq/resync ring buffer in the backend only replays into the messaging
 *     store, and it is dropped entirely on a server restart),
 *   - the tab becoming visible again (nothing is polled while hidden),
 *   - midnight, because "Messages Today" and "new today" reset then and no
 *     event fires for the passage of time.
 */

/** Which sections each backend event can invalidate. */
const EVENT_SECTIONS: Record<string, StatsSection[]> = {
  'message:new':        ['overview', 'series'],
  'conversation:updated': ['overview', 'agents'],
  'lead:updated':       ['overview'],
  'deal:created':       ['pipeline'],
  'deal:updated':       ['pipeline'],
  'deal:deleted':       ['pipeline'],
  'broadcast:complete': ['overview', 'series'],
};

/** Long enough to swallow a burst of inbound messages, short enough to feel live. */
const DEBOUNCE_MS = 800;

/** Backstop for anything no event covers. Only runs while the tab is visible. */
const POLL_MS = 60_000;

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  // +2s of slack so the request lands after the boundary, not exactly on it.
  return next.getTime() - now.getTime() + 2_000;
}

export function useLiveStats(sections: StatsSection[]) {
  const refresh = useStatsStore((s) => s.refresh);

  // Depend on the *contents* of the list, not its identity: a caller passing an
  // inline array literal would otherwise tear down and re-subscribe every
  // render, re-firing the initial fetch each time.
  const sectionKey = sections.join(',');

  useEffect(() => {
    const mySections = sectionKey.split(',') as StatsSection[];

    let disposed = false;
    const dirty = new Set<StatsSection>();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let midnight: ReturnType<typeof setTimeout> | null = null;

    const mine = (s: StatsSection) => mySections.includes(s);

    function flush() {
      debounce = null;
      if (disposed || dirty.size === 0) return;
      const batch = [...dirty];
      dirty.clear();
      void refresh(batch);
    }

    function invalidate(targets: StatsSection[]) {
      const relevant = targets.filter(mine);
      if (relevant.length === 0) return;
      relevant.forEach((s) => dirty.add(s));
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flush, DEBOUNCE_MS);
    }

    // Initial load — forced past the coalescing floor so a remount always paints.
    void refresh(mySections, { force: true });

    const listeners: Array<[string, (...args: unknown[]) => void]> = [];
    for (const [event, targets] of Object.entries(EVENT_SECTIONS)) {
      const handler = () => invalidate(targets);
      socket.on(event, handler);
      listeners.push([event, handler]);
    }

    const onReconnect = () => { void refresh(mySections, { force: true }); };
    socket.on('connect', onReconnect);

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refresh(mySections, { force: true });
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(mySections);
    }, POLL_MS);

    function scheduleMidnight() {
      midnight = setTimeout(() => {
        void refresh(mySections, { force: true });
        scheduleMidnight();
      }, msUntilNextMidnight());
    }
    scheduleMidnight();

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      if (midnight) clearTimeout(midnight);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.off('connect', onReconnect);
      for (const [event, handler] of listeners) socket.off(event, handler);
    };
  }, [sectionKey, refresh]);
}
