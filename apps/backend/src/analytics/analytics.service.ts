import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getTenantId } from '../lib/tenant-context';
import { teamScope, isAdmin, excludeDevSuperuser, type AuthActor } from '../auth/authorize';

/**
 * Dashboard analytics.
 *
 * Two rules shape everything here, both learned from numbers that disagreed
 * with the pages they link to:
 *
 * 1. **Every figure is team-scoped through `teamScope(actor)`.** A KPI card is a
 *    link to a list; if the card counts rows the list will not show, the card is
 *    wrong. `/api/leads/stats` and the deals board already scope this way, so an
 *    unscoped overview made the dashboard contradict them.
 *
 * 2. **"Today" is the *viewer's* today.** The client sends its IANA zone and day
 *    boundaries are computed in it. Server-local midnight (and, worse, UTC
 *    bucketing in the chart while the KPI used server-local) meant the
 *    "Messages Today" card and the last bar of the chart disagreed by the UTC
 *    offset — 3h of messages in the wrong day for a UTC+3 tenant.
 */

// ── Timezone helpers ──────────────────────────────────────────────────────────

/** Reject junk before it reaches `AT TIME ZONE`; fall back to UTC. */
export function safeTimeZone(tz?: string | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Milliseconds `tz` is ahead of UTC at the given instant (DST-aware). */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which a calendar day *starts* in `tz`.
 * `dayOffset` walks whole calendar days (-1 = yesterday).
 *
 * Normalises the zone itself rather than trusting the caller: `Intl` throws a
 * RangeError on an unknown zone, and a client is free to send anything as `?tz`.
 * One bad query string should not 500 the whole dashboard.
 */
export function startOfDayInTz(zone: string, dayOffset = 0, now = new Date()): Date {
  const tz = safeTimeZone(zone);
  const offset = tzOffsetMs(tz, now);
  const wall = new Date(now.getTime() + offset);
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(wall.getUTCDate() + dayOffset);
  // Re-resolve the offset at the target instant: across a DST boundary the
  // offset that applies *then* is not the one that applies now.
  const provisional = new Date(wall.getTime() - offset);
  const settled = tzOffsetMs(tz, provisional);
  return settled === offset ? provisional : new Date(wall.getTime() - settled);
}

/** "YYYY-MM-DD" for an instant, as seen in `tz`. */
function dayKeyInTz(tz: string, at: Date): string {
  // en-CA formats as YYYY-MM-DD, which is also how the SQL buckets are keyed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

// ── Raw-SQL scoping ───────────────────────────────────────────────────────────

/**
 * The Prisma tenant-guard does NOT intercept `$queryRaw` (see lib/prisma.ts), so
 * raw analytics queries must fence themselves. Returning null here means "no
 * tenant in context" — the caller answers empty rather than scanning every
 * tenant's messages.
 */
function rawTenantId(): string | null {
  return getTenantId();
}

/**
 * The raw-SQL twin of `teamScope()`. Must stay behaviourally identical to it,
 * or the chart and the KPI cards would answer for different populations.
 */
function rawTeamScope(actor: AuthActor, column: Prisma.Sql): Prisma.Sql {
  if (isAdmin(actor.role)) return Prisma.sql`TRUE`;
  if (actor.teamId) return Prisma.sql`(${column} = ${actor.teamId} OR ${column} IS NULL)`;
  return Prisma.sql`${column} IS NULL`;
}

// ── What counts as "a contact" / "a conversation" ─────────────────────────────

/**
 * WhatsApp group chats are stored as ordinary Conversation rows against a
 * pseudo-Contact whose "phone" is the group JID (`1203630...@g.us`). Neither
 * list page shows them:
 *   - the inbox hardcodes `{ isGroup: false }`  (conversations.service.ts)
 *   - the contacts list excludes @g.us/@broadcast (contacts.service.ts)
 *
 * The dashboard did not, so it counted a population no page in the app will
 * show you — one linked account with 81 groups read as "82 open conversations"
 * next to an inbox containing one. A KPI card is a link to a list; if the count
 * and the list disagree, the card is simply wrong.
 *
 * Keep these in sync with the two services above.
 */
const REAL_CONTACT: Array<Record<string, unknown>> = [
  { NOT: { phone: { contains: '@g.us' } } },
  { NOT: { phone: { contains: '@broadcast' } } },
];

/** Conversations the inbox would actually list. */
const DIRECT_CONVERSATION = { isGroup: false } as const;

// ── Service ───────────────────────────────────────────────────────────────────

export interface OverviewResult {
  totalContacts: number;
  openConversations: number;
  todayMessages: number;
  hotLeads: number;
  /**
   * Real second-order numbers for the KPI captions. These exist because the
   * cards used to render a fixed caption next to a hard-coded up-arrow, which
   * reads as growth the API never measured.
   */
  newContactsToday: number;
  unansweredConversations: number;
  yesterdayMessages: number;
  hotLeadsToday: number;
  /** Echoed back so the client can prove which day the numbers describe. */
  timeZone: string;
  asOf: string;
}

export class AnalyticsService {
  static async getOverview(actor: AuthActor, timeZone?: string): Promise<OverviewResult> {
    const tz = safeTimeZone(timeZone);
    const todayStart = startOfDayInTz(tz, 0);
    const tomorrowStart = startOfDayInTz(tz, 1);
    const yesterdayStart = startOfDayInTz(tz, -1);

    const contactScope = teamScope(actor);
    const convScope = teamScope(actor);
    const leadScope = teamScope(actor);

    const [
      totalContacts,
      openConversations,
      todayMessages,
      hotLeads,
      newContactsToday,
      unansweredConversations,
      yesterdayMessages,
      hotLeadsToday,
    ] = await Promise.all([
      prisma.contact.count({ where: { AND: [...REAL_CONTACT, contactScope] } }),

      // Snoozed conversations are excluded: the operator deliberately deferred
      // them, so counting them under "awaiting your reply" manufactures work.
      prisma.conversation.count({
        where: {
          ...convScope,
          ...DIRECT_CONVERSATION,
          status: 'OPEN',
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
        },
      }),

      prisma.message.count({
        where: {
          timestamp: { gte: todayStart, lt: tomorrowStart },
          conversation: { ...convScope, ...DIRECT_CONVERSATION },
        },
      }),

      prisma.leadQualification.count({
        where: { ...leadScope, status: 'HOT', contact: { AND: REAL_CONTACT } },
      }),

      prisma.contact.count({
        where: {
          AND: [...REAL_CONTACT, contactScope, { createdAt: { gte: todayStart, lt: tomorrowStart } }],
        },
      }),

      // The subset of open conversations carrying unread inbound messages —
      // the actionable part of the number above, which otherwise includes
      // threads already read and simply not resolved.
      prisma.conversation.count({
        where: {
          ...convScope,
          ...DIRECT_CONVERSATION,
          status: 'OPEN',
          unreadCount: { gt: 0 },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
        },
      }),

      prisma.message.count({
        where: {
          timestamp: { gte: yesterdayStart, lt: todayStart },
          conversation: { ...convScope, ...DIRECT_CONVERSATION },
        },
      }),

      prisma.leadQualification.count({
        where: {
          ...leadScope,
          status: 'HOT',
          contact: { AND: REAL_CONTACT },
          updatedAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
    ]);

    return {
      totalContacts,
      openConversations,
      todayMessages,
      hotLeads,
      newContactsToday,
      unansweredConversations,
      yesterdayMessages,
      hotLeadsToday,
      timeZone: tz,
      asOf: new Date().toISOString(),
    };
  }

  /**
   * Daily inbound/outbound volume, zero-filled across the whole window.
   *
   * Aggregated in Postgres rather than by loading rows: the previous version
   * pulled every message of the last 30 days into Node on every poll, per open
   * dashboard, to produce at most 30 output rows.
   *
   * Zero-filling is not cosmetic — the frontend used to take the last 7 returned
   * rows, and days with no traffic were simply absent, so "the last 7 days"
   * silently stretched across weeks on a quiet account.
   */
  static async getMessagesChart(
    actor: AuthActor,
    timeZone?: string,
    days = 7,
  ): Promise<Array<{ date: string; incoming: number; outgoing: number }>> {
    const tz = safeTimeZone(timeZone);
    const span = Math.min(90, Math.max(1, Math.trunc(days) || 7));
    const tenantId = rawTenantId();
    if (!tenantId) return [];

    const from = startOfDayInTz(tz, -(span - 1));
    const until = startOfDayInTz(tz, 1);

    const rows = await prisma.$queryRaw<Array<{ day: string; incoming: bigint; outgoing: bigint }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', m."timestamp" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE m."fromMe" IS NOT TRUE) AS incoming,
             COUNT(*) FILTER (WHERE m."fromMe" IS TRUE)     AS outgoing
        FROM "Message" m
        JOIN "Conversation" c ON c."id" = m."conversationId"
       WHERE m."tenantId" = ${tenantId}
         AND m."timestamp" >= ${from}
         AND m."timestamp" <  ${until}
         AND c."isGroup" IS NOT TRUE
         AND ${rawTeamScope(actor, Prisma.sql`c."teamId"`)}
       GROUP BY 1
    `);

    const byDay = new Map(rows.map((r) => [r.day, { incoming: Number(r.incoming), outgoing: Number(r.outgoing) }]));

    const series: Array<{ date: string; incoming: number; outgoing: number }> = [];
    for (let i = span - 1; i >= 0; i--) {
      const key = dayKeyInTz(tz, startOfDayInTz(tz, -i));
      const hit = byDay.get(key);
      series.push({ date: key, incoming: hit?.incoming ?? 0, outgoing: hit?.outgoing ?? 0 });
    }
    return series;
  }

  /**
   * Per-agent workload. Two queries total, regardless of headcount — this used
   * to fan out to 3 queries per agent (61 queries for a 20-person team) on
   * every dashboard poll.
   */
  static async getAgentStats(actor: AuthActor) {
    const tenantId = rawTenantId();

    // Managers who carry conversations were previously invisible here: the
    // filter was role-based, so an ADMIN working the inbox never appeared.
    const members = await prisma.user.findMany({
      where: { ...teamScope(actor), ...excludeDevSuperuser() },
      select: { id: true, name: true, email: true },
    });
    if (members.length === 0) return [];

    const memberIds = members.map((m) => m.id);

    const grouped = await prisma.conversation.groupBy({
      by: ['assignedTo', 'status'],
      where: { ...teamScope(actor), ...DIRECT_CONVERSATION, assignedTo: { in: memberIds } },
      _count: { _all: true },
    });

    const counts = new Map<string, { open: number; resolved: number }>();
    for (const row of grouped) {
      if (!row.assignedTo) continue;
      const entry = counts.get(row.assignedTo) ?? { open: 0, resolved: 0 };
      if (row.status === 'OPEN') entry.open += row._count._all;
      if (row.status === 'RESOLVED') entry.resolved += row._count._all;
      counts.set(row.assignedTo, entry);
    }

    // Avg time from a conversation opening to our first outbound message, over
    // the last 30 days. Capped rather than filtered at 24h: dropping the slow
    // ones made a bad average look good. Windowed and fully aggregated, so the
    // figure is deterministic — the old version sampled 100 rows with no
    // ORDER BY, and the number jittered on every refresh.
    const responseByAgent = new Map<string, number>();
    if (tenantId) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.$queryRaw<Array<{ agent_id: string; avg_ms: number | null }>>(Prisma.sql`
        SELECT c."assignedTo" AS agent_id,
               AVG(LEAST(EXTRACT(EPOCH FROM (fr.first_out - c."createdAt")), 86400) * 1000) AS avg_ms
          FROM "Conversation" c
          CROSS JOIN LATERAL (
                SELECT MIN(m."timestamp") AS first_out
                  FROM "Message" m
                 WHERE m."conversationId" = c."id"
                   AND m."fromMe" IS TRUE
               ) fr
         WHERE c."tenantId" = ${tenantId}
           AND c."isGroup" IS NOT TRUE
           AND c."assignedTo" IS NOT NULL
           AND c."createdAt" >= ${since}
           AND fr.first_out IS NOT NULL
           AND fr.first_out > c."createdAt"
           AND ${rawTeamScope(actor, Prisma.sql`c."teamId"`)}
         GROUP BY 1
      `);
      for (const r of rows) {
        if (r.avg_ms != null) responseByAgent.set(r.agent_id, Math.round(Number(r.avg_ms)));
      }
    }

    return members
      .map((m) => {
        const c = counts.get(m.id) ?? { open: 0, resolved: 0 };
        const avgMs = responseByAgent.get(m.id) ?? null;
        return {
          agentId: m.id,
          name: m.name,
          email: m.email,
          openConversations: c.open,
          resolvedConversations: c.resolved,
          avgFirstResponseMs: avgMs,
          avgFirstResponseMin: avgMs != null ? Math.round(avgMs / 60000) : null,
        };
      })
      // Somebody with no conversations at all is not "an agent with 0% resolution",
      // they are simply not on the board.
      .filter((a) => a.openConversations + a.resolvedConversations > 0)
      .sort((a, b) => (b.openConversations + b.resolvedConversations) - (a.openConversations + a.resolvedConversations));
  }

  /**
   * Deal funnel.
   *
   * Scoped on `Deal.teamId` (which is indexed as `[teamId, stage]`) rather than
   * by walking contact → conversations → teamId. The old join returned a
   * different *set*, not just a slower one: a deal whose contact had ever
   * spoken to another team leaked into that team's pipeline.
   */
  static async getPipelineStats(actor: AuthActor) {
    const stages = ['NEW', 'INTERESTED', 'NEGOTIATION', 'CLOSED'] as const;

    const dealsByStage = await prisma.deal.groupBy({
      by: ['stage'],
      where: { ...teamScope(actor) },
      _count: { id: true },
      _sum: { value: true },
    });

    const stageMap = new Map(dealsByStage.map((r) => [r.stage, { count: r._count.id, value: r._sum.value ?? 0 }]));
    const totalDeals = dealsByStage.reduce((s, r) => s + r._count.id, 0);
    const totalValue = dealsByStage.reduce((s, r) => s + (r._sum.value ?? 0), 0);
    const closedDeals = stageMap.get('CLOSED')?.count ?? 0;
    const closedValue = stageMap.get('CLOSED')?.value ?? 0;

    // `DealStage` has no won/lost split, so this is the share of deals that
    // reached the final stage — not a win rate. Named `conversionRate` for
    // back-compat with the widget; `closedValue` is the honest money figure.
    const conversionRate = totalDeals > 0 ? Math.round((closedDeals / totalDeals) * 100) : 0;
    const openValue = totalValue - closedValue;

    return {
      stages: stages.map((stage) => ({
        stage,
        count: stageMap.get(stage)?.count ?? 0,
        value: stageMap.get(stage)?.value ?? 0,
      })),
      totalDeals,
      totalValue,
      closedDeals,
      closedValue,
      openValue,
      conversionRate,
    };
  }
}
