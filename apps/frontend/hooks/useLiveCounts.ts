'use client';

import { useStatsStore } from '../stores/stats-store';

/**
 * The open-conversation badge for the sidebar / bottom nav / mobile drawer.
 *
 * Reads the shared stats store rather than fetching: `RealtimeProvider` drives
 * the refresh once for the whole shell. This hook used to own a fetch *and* a
 * pair of client-side increments with no poll behind them, so three components
 * each hit `/api/analytics/overview` on mount and then drifted apart from each
 * other and from the server for the rest of the session.
 *
 * Null means "not answered yet", which the badges render as nothing at all —
 * a flash of `0` reads as "inbox clear" and is worse than an empty space.
 */
export function useLiveCounts() {
  const openConversations = useStatsStore((s) => s.overview?.openConversations ?? null);
  const loaded = useStatsStore((s) => s.loaded.overview);

  return { openConversations: loaded ? openConversations : null };
}
