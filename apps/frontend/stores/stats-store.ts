import { create } from 'zustand';
import { api } from '../lib/api';

/**
 * Dashboard statistics, as one shared source of truth.
 *
 * Two problems this exists to solve:
 *
 * 1. **Fan-out.** `/api/analytics/overview` was fetched four times on every
 *    dashboard mount — Sidebar, BottomNav, MobileDrawer and the page each ran
 *    their own `useEffect`. There is no query cache in this app to dedupe them,
 *    so the dedupe lives here.
 *
 * 2. **Drift.** The live numbers used to be client-side increments applied to a
 *    snapshot (`openConversations + 1` on any `conversation:updated` carrying a
 *    status). `conversation:updated` fires on assignment, priority, snooze and
 *    reopen too, so an already-OPEN conversation incremented the counter again
 *    and every non-OPEN transition decremented it — the badge wandered away
 *    from reality until the next poll, and in the sidebar (which never polled)
 *    it wandered indefinitely.
 *
 *    So: the server is the only thing that counts. Realtime events mean
 *    "this section is stale", never "add one".
 */

export type StatsSection = 'overview' | 'series' | 'agents' | 'pipeline';

export interface OverviewData {
  totalContacts: number;
  openConversations: number;
  todayMessages: number;
  hotLeads: number;
  newContactsToday: number;
  unansweredConversations: number;
  yesterdayMessages: number;
  hotLeadsToday: number;
  timeZone: string;
  asOf: string;
}

export interface MessagePoint {
  date: string;
  incoming: number;
  outgoing: number;
}

export interface AgentStat {
  agentId: string;
  name: string;
  email: string;
  openConversations: number;
  resolvedConversations: number;
  avgFirstResponseMin: number | null;
}

export interface PipelineStats {
  stages: { stage: string; count: number; value: number }[];
  totalDeals: number;
  totalValue: number;
  closedDeals: number;
  closedValue: number;
  openValue: number;
  conversionRate: number;
}

interface StatsState {
  overview: OverviewData | null;
  series: MessagePoint[] | null;
  agents: AgentStat[] | null;
  pipeline: PipelineStats | null;
  /** Per-section: has a response (success or failure) landed at least once? */
  loaded: Record<StatsSection, boolean>;
  /** Only set for `overview` — the one section whose failure the page surfaces. */
  error: string | null;
  refresh: (sections: StatsSection[], opts?: { force?: boolean }) => Promise<void>;
}

/** The viewer's zone, so the backend's "today" is the one on their wall. */
function clientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Days the chart shows. Requested explicitly so the server zero-fills to match. */
export const CHART_DAYS = 7;

function endpointFor(section: StatsSection): string {
  const tz = encodeURIComponent(clientTimeZone());
  switch (section) {
    case 'overview': return `/api/analytics/overview?tz=${tz}`;
    case 'series':   return `/api/analytics/messages?tz=${tz}&days=${CHART_DAYS}`;
    case 'agents':   return '/api/analytics/agents';
    case 'pipeline': return '/api/analytics/pipeline';
  }
}

// ── Request coalescing ────────────────────────────────────────────────────────
// A burst of inbound messages fires one socket event each. Without a floor,
// every one of them would become four HTTP requests per open tab.
const MIN_INTERVAL_MS = 2_000;
const inflight = new Map<StatsSection, Promise<void>>();
const lastStartedAt: Record<StatsSection, number> = {
  overview: 0, series: 0, agents: 0, pipeline: 0,
};

export const useStatsStore = create<StatsState>((set) => {
  function fetchSection(section: StatsSection, force: boolean): Promise<void> {
    const running = inflight.get(section);
    if (running) return running;
    if (!force && Date.now() - lastStartedAt[section] < MIN_INTERVAL_MS) {
      return Promise.resolve();
    }
    lastStartedAt[section] = Date.now();

    const done = api.get(endpointFor(section))
      .then((data) => {
        switch (section) {
          case 'overview':
            // A shape check, not paranoia: a 200 with an error body would
            // otherwise blank every KPI to `undefined`.
            if (data && typeof data.totalContacts === 'number') {
              set({ overview: data as OverviewData, error: null });
            }
            break;
          case 'series':
            set({ series: Array.isArray(data) ? (data as MessagePoint[]) : [] });
            break;
          case 'agents':
            set({ agents: Array.isArray(data) ? (data as AgentStat[]) : [] });
            break;
          case 'pipeline':
            set({ pipeline: data && typeof data.totalDeals === 'number' ? (data as PipelineStats) : null });
            break;
        }
      })
      .catch((err: unknown) => {
        if (section === 'overview') {
          set({ error: err instanceof Error ? err.message : 'Failed to load dashboard data' });
        } else if (section === 'series') {
          set({ series: [] });
        } else if (section === 'agents') {
          set({ agents: [] });
        }
        // `pipeline` keeps its last good value — an empty funnel and a failed
        // request render identically otherwise, and the widget would claim
        // "No deals yet" during a blip.
      })
      .finally(() => {
        inflight.delete(section);
        set((s) => (s.loaded[section] ? s : { loaded: { ...s.loaded, [section]: true } }));
      });

    inflight.set(section, done);
    return done;
  }

  return {
    overview: null,
    series: null,
    agents: null,
    pipeline: null,
    loaded: { overview: false, series: false, agents: false, pipeline: false },
    error: null,
    refresh: (sections, opts) =>
      Promise.all(sections.map((s) => fetchSection(s, opts?.force ?? false))).then(() => undefined),
  };
});
