import webpush from 'web-push';
import { Prisma } from '@prisma/client';
import { prismaUnscoped } from '../lib/prisma';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { HIGH_PRIORITY_TYPES, unpackBilingual, type Bilingual } from './shared';

/**
 * Web Push (phone / desktop) delivery for stored notifications.
 *
 * Every Notification row is pushed at most once: a send first *claims* the row
 * by stamping `pushedAt` in a single UPDATE … WHERE "pushedAt" IS NULL, so the
 * immediate send, the safety sweep and a second server instance can never push
 * the same row twice. Rows created while the process was down (or whose
 * immediate send was lost to a restart) are picked up by the sweep.
 *
 * Enabled only when VAPID keys are configured (env.webPush). Everything here is
 * a safe no-op otherwise, so the CRM runs fine without push set up.
 */

interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface ClaimedRow {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  conversationId: string | null;
  dedupeKey: string | null;
  createdAt: Date;
}

/** One push as it will appear on the phone, before it is put into a language. */
interface PushItem {
  title: Bilingual;
  body: Bilingual;
  url: string;
  tag: string;
  type: string;
  high: boolean;
  notificationId?: string;
  createdAt: Date;
}

/** Wait this long after a notification is created so a burst goes out grouped. */
const BATCH_DELAY_MS = 1200;
/** Safety sweep for anything not yet pushed (restarts, lost timers). */
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
/** Older than this is stale — skipped rather than sent late. */
const STALE_MS = 6 * 60 * 60 * 1000;
const MAX_PUSHES_PER_PERSON = 4;
const DIGEST_THRESHOLD = 3;
const CLAIM_LIMIT = 500;

class PushService {
  private configured = false;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  private init(): boolean {
    if (this.configured) return true;
    const cfg = env.webPush;
    if (!cfg) return false;
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    this.configured = true;
    return true;
  }

  isEnabled(): boolean {
    return Boolean(env.webPush);
  }

  get publicKey(): string | null {
    return env.webPush?.publicKey ?? null;
  }

  /**
   * Store (or refresh) a device subscription. Idempotent per endpoint, and the
   * person signed in now takes the device over from whoever had it before.
   */
  async saveSubscription(userId: string, sub: BrowserSubscription, userAgent?: string, locale?: string): Promise<void> {
    const lang = locale === 'ar' ? 'ar' : 'en';
    await prismaUnscoped.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, locale: lang },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, locale: lang },
    });
  }

  /** Only the device's current owner may remove it. */
  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await prismaUnscoped.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }

  async deviceCount(userId: string): Promise<number> {
    return prismaUnscoped.pushSubscription.count({ where: { userId } });
  }

  async hasDevice(userId: string, endpoint: string): Promise<boolean> {
    return (await prismaUnscoped.pushSubscription.count({ where: { userId, endpoint } })) > 0;
  }

  /** Queue freshly stored notifications for a push. Grouped over a short window. */
  enqueue(ids: string[], opts: { immediate?: boolean } = {}): void {
    if (!this.isEnabled()) return;
    for (const id of ids) this.pending.add(id);
    if (opts.immediate) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.flush();
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const ids = [...this.pending];
    this.pending.clear();
    if (ids.length > 0) await this.dispatch(ids);
  }

  /** Runs for the life of the process; the first tick also catches up after a restart. */
  startSweeper(): NodeJS.Timeout | null {
    if (!this.isEnabled()) return null;
    setTimeout(() => void this.dispatch(null), 15_000).unref();
    const t = setInterval(() => void this.dispatch(null), SWEEP_INTERVAL_MS);
    t.unref();
    return t;
  }

  /**
   * Claim and push unsent notifications — the given ids, or (sweep) everything
   * recent that has not been pushed yet. Never throws.
   */
  async dispatch(ids: string[] | null): Promise<void> {
    if (!this.init()) return;
    try {
      const cutoff = new Date(Date.now() - STALE_MS);
      const only = ids ? Prisma.sql`AND id = ANY(${ids}::text[])` : Prisma.empty;
      // Cross-tenant system work: rows are routed to their own recipient's
      // devices only, so no tenant filter is needed here.
      const rows = await prismaUnscoped.$queryRaw<ClaimedRow[]>`
        UPDATE "Notification" SET "pushedAt" = NOW()
        WHERE id IN (
          SELECT id FROM "Notification"
          WHERE "pushedAt" IS NULL AND "createdAt" > ${cutoff} ${only}
          ORDER BY "createdAt" ASC
          LIMIT ${CLAIM_LIMIT}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "recipientId", type::text AS type, title, body, url, "conversationId", "dedupeKey", "createdAt"`;
      if (rows.length === 0) return;

      const byRecipient = new Map<string, ClaimedRow[]>();
      for (const r of rows) {
        const list = byRecipient.get(r.recipientId) ?? [];
        list.push(r);
        byRecipient.set(r.recipientId, list);
      }
      const recipientIds = [...byRecipient.keys()];

      const [subs, unread] = await Promise.all([
        prismaUnscoped.pushSubscription.findMany({ where: { userId: { in: recipientIds } } }),
        prismaUnscoped.notification.groupBy({
          by: ['recipientId'],
          where: { recipientId: { in: recipientIds }, isRead: false },
          _count: { _all: true },
        }),
      ]);
      if (subs.length === 0) return;
      const unreadBy = new Map(unread.map((u) => [u.recipientId, u._count._all]));

      let sent = 0;
      await Promise.all(
        recipientIds.map(async (recipientId) => {
          const devices = subs.filter((s) => s.userId === recipientId);
          if (devices.length === 0) return;
          const items = plan(byRecipient.get(recipientId)!);
          const badge = unreadBy.get(recipientId) ?? 0;
          // Oldest first, so the newest ends up on top of the phone's list.
          for (const item of items.reverse()) {
            for (const d of devices) {
              if (await this.send(d, item, badge)) sent++;
            }
          }
        }),
      );
      logger.info('push.dispatched', { notifications: rows.length, recipients: recipientIds.length, sent, sweep: !ids });
    } catch (err) {
      logger.warn('push.dispatch_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async send(
    device: { endpoint: string; p256dh: string; auth: string; locale: string | null },
    item: PushItem,
    badge: number,
  ): Promise<boolean> {
    const ar = device.locale === 'ar';
    const payload = {
      title: ar ? item.title.ar || item.title.en : item.title.en || item.title.ar,
      body: ar ? item.body.ar || item.body.en : item.body.en || item.body.ar,
      url: item.url,
      tag: item.tag,
      type: item.type,
      nid: item.notificationId ?? null,
      lang: ar ? 'ar' : 'en',
      dir: ar ? 'rtl' : 'ltr',
      badge,
    };
    // Expire on the push service when it would be stale anyway.
    const ttl = Math.max(60, Math.floor((STALE_MS - (Date.now() - item.createdAt.getTime())) / 1000));
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        { TTL: ttl, urgency: item.high ? 'high' : 'normal', topic: topicFor(item.tag) },
      );
      return true;
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        // The device unsubscribed or the browser dropped it — forget it.
        await prismaUnscoped.pushSubscription.deleteMany({ where: { endpoint: device.endpoint } }).catch(() => {});
      } else {
        logger.warn('push.send_failed', { code, error: err instanceof Error ? err.message : String(err) });
      }
      return false;
    }
  }
}

/**
 * Turn one person's batch of notifications into the pushes their phone shows:
 * one per chat (the latest), a digest for 3+ deadlines, and at most four in all.
 * Returned newest first.
 */
export function plan(rows: ClaimedRow[]): PushItem[] {
  const newest = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const items: PushItem[] = [];
  const seenTags = new Set<string>();
  const deadlines: ClaimedRow[] = [];

  for (const r of newest) {
    if (r.type === 'TASK_DUE') { deadlines.push(r); continue; }
    const tag = r.conversationId && r.type === 'MESSAGE' ? `conv:${r.conversationId}` : `n:${r.id}`;
    if (seenTags.has(tag)) continue;
    seenTags.add(tag);
    items.push(toItem(r, tag));
  }

  if (deadlines.length >= DIGEST_THRESHOLD) {
    items.push(deadlineDigest(deadlines));
  } else {
    for (const r of deadlines) items.push(toItem(r, `n:${r.id}`));
  }
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (items.length <= MAX_PUSHES_PER_PERSON) return items;
  const shown = items.slice(0, MAX_PUSHES_PER_PERSON - 1);
  const more = items.length - shown.length;
  shown.push({
    title: { en: `${more} more notifications`, ar: `${more} إشعارات أخرى` },
    body: { en: 'Open Nexus to see them all.', ar: 'افتح Nexus لعرضها كلها.' },
    url: '/dashboard?inbox=1',
    tag: 'more',
    type: 'DIGEST',
    high: false,
    createdAt: items[MAX_PUSHES_PER_PERSON - 1].createdAt,
  });
  return shown;
}

function toItem(r: ClaimedRow, tag: string): PushItem {
  const title = unpackBilingual(r.title);
  const body = r.body ? unpackBilingual(r.body) : { en: '', ar: '' };
  return {
    title,
    body,
    url: withNotificationId(r.url ?? (r.conversationId ? `/conversations?conversationId=${encodeURIComponent(r.conversationId)}` : '/dashboard'), r.id),
    tag,
    type: r.type,
    high: HIGH_PRIORITY_TYPES.has(r.type as never),
    notificationId: r.id,
    createdAt: r.createdAt,
  };
}

/** dedupeKey for deadlines is "task-due:<taskId>:<overdue|today|tomorrow>". */
function deadlineDigest(rows: ClaimedRow[]): PushItem {
  const count = { overdue: 0, today: 0, tomorrow: 0 };
  for (const r of rows) {
    const phase = r.dedupeKey?.split(':')[2] as keyof typeof count | undefined;
    if (phase && phase in count) count[phase]++;
  }
  const en: string[] = [];
  const ar: string[] = [];
  if (count.overdue) { en.push(`${count.overdue} overdue`); ar.push(`${count.overdue} متأخرة`); }
  if (count.today) { en.push(`${count.today} due today`); ar.push(`${count.today} مستحقة اليوم`); }
  if (count.tomorrow) { en.push(`${count.tomorrow} due tomorrow`); ar.push(`${count.tomorrow} مستحقة غدًا`); }
  return {
    title: { en: `${rows.length} tasks need your attention`, ar: `${rows.length} مهام تحتاج انتباهك` },
    body: { en: en.join(' · '), ar: ar.join(' · ') },
    url: '/tasks',
    tag: 'deadlines',
    type: 'TASK_DUE',
    high: false,
    createdAt: rows[0].createdAt,
  };
}

function withNotificationId(url: string, id: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}nid=${encodeURIComponent(id)}`;
}

/** Push-service collapse key: a newer push with the same topic replaces an undelivered older one. */
function topicFor(tag: string): string {
  return tag.replace(/[^A-Za-z0-9\-_]/g, '').slice(0, 32) || 'nexus';
}

export const pushService = new PushService();
