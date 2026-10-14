'use client';

import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useLiveStats } from '../../hooks/useLiveStats';
import type { StatsSection } from '../../stores/stats-store';

/** Sections the whole shell needs — the sidebar/bottom-nav conversation badge. */
const SHELL_SECTIONS: StatsSection[] = ['overview'];

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtimeSync();
  // Mounted once for every dashboard route, so the shell badge stays live off a
  // single request instead of the three separate ones the nav components each
  // used to fire. The dashboard page mounts its own hook for the heavier
  // sections; the store coalesces the overlap.
  useLiveStats(SHELL_SECTIONS);
  return <>{children}</>;
}
