import { Prisma, type NotificationType, type Priority } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emitToUser } from '../realtime/socket';
import { excludeDevSuperuser } from '../auth/authorize';
import { pushService } from './push.service';
import {
  CATEGORY_OF,
  HIGH_PRIORITY_TYPES,
  NOTIFY_CATEGORIES,
  pack,
  unpackBilingual,
  type Bilingual,
  type NotifyCategory,
} from './shared';

export { unpackBilingual };


export interface NotifyInput {
  type: NotificationType;
  recipients: string[];
  /** The user who caused this — they are never notified about their own action. */
  actorId?: string | null;
  actorName?: string | null;
  title: Bilingual;
  body?: Bilingual | null;
  /** In-app path opened on tap. Defaults to the conversation when there is one. */
  url?: string | null;
  priority?: Priority;
  contactId?: string | null;
  conversationId?: string | null;
  teamId?: string | null;
  /** Same key for the same recipient never creates a second notification. */
  dedupeKey?: string | null;
  /**
   * Fold into the recipient's unread notification of the same type for the same
   * conversation instead of stacking a new one (a burst of chat messages).
   * Receives the new total so the title can say "3 new messages".
   */
  foldTitle?: (count: number) => Bilingual;
}

/** Legacy shape used by the AI lead alerts (team-targeted). */
export interface CreateNotificationInput {
  type: NotificationType;
  priority?: Priority;
  titleEn: string;
  titleAr: string;
  bodyEn?: string;
  bodyAr?: string;
  contactId: string;
  conversationId: string;
  teamId: string | null;
  /** If the conversation is assigned, only this user is notified. */
  assignedTo?: string | null;
}

const NON_RECIPIENT_ROLES = new Set(['VIEWER']);

/**
 * Who hears about activity on a conversation:
 * - assigned conversation → just the assigned agent
 * - otherwise            → every actionable member of the team
 *   (team-less conversations notify all actionable users — single-org fallback).
 */
export async function conversationRecipients(teamId: string | null, assignedTo?: string | null): Promise<string[]> {
  if (assignedTo) return [assignedTo];

  const users = await prisma.user.findMany({
    where: { ...(teamId ? { teamId } : {}), ...excludeDevSuperuser() },
    select: { id: true, role: true },
  });
  return users.filter((u) => !NON_RECIPIENT_ROLES.has(u.role)).map((u) => u.id);
}

export function conversationUrl(conversationId: string): string {
  return `/conversations?conversationId=${encodeURIComponent(conversationId)}`;
}

function switchedOff(prefs: Prisma.JsonValue | null): Set<string> {
  const off = (prefs as { off?: unknown } | null)?.off;
  return new Set(Array.isArray(off) ? off.filter((x): x is string => typeof x === 'string') : []);
}

class NotificationsService {
  /**
   * The one way anything in the CRM notifies a person. Stores one row per
   * recipient — that row drives the inbox, the live in-app banner, and the
   * phone push (which the push dispatcher picks up from it). Never throws.
   */
  async notify(input: NotifyInput): Promise<string[]> {
    try {
      const isTest = input.type === 'TEST';
      const ids = [...new Set(input.recipients.filter(Boolean))].filter(
        (id) => isTest || id !== input.actorId,
      );
      if (ids.length === 0) return [];

      // Tenant-guarded: only people who still exist in this tenant come back.
      const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, notificationPrefs: true },
      });
      const category = CATEGORY_OF[input.type];
      const recipients = users
        .filter((u) => !category || !switchedOff(u.notificationPrefs).has(category))
        .map((u) => u.id);
      if (recipients.length === 0) return [];

      const priority: Priority = input.priority ?? (HIGH_PRIORITY_TYPES.has(input.type) ? 'HIGH' : 'NORMAL');
      const url = input.url ?? (input.conversationId ? conversationUrl(input.conversationId) : null);
      const body = input.body ? pack(input.body) : null;

      const created: string[] = [];
      await Promise.all(
        recipients.map(async (recipientId) => {
          try {
            const row = await this.writeOne(recipientId, input, { priority, url, body });
            if (!row) return;
            created.push(row.id);
            emitToUser(recipientId, 'notification:new', serialize(row));
          } catch (err) {
            logger.warn('notifications.create_failed', {
              recipientId,
              type: input.type,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );

      if (created.length > 0) {
        pushService.enqueue(created, { immediate: isTest });
        logger.info('notifications.created', { type: input.type, recipients: created.length });
      }
      return created;
    } catch (err) {
      logger.warn('notifications.notify_failed', {
        type: input.type,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async writeOne(
    recipientId: string,
    input: NotifyInput,
    resolved: { priority: Priority; url: string | null; body: string | null },
  ) {
    if (input.foldTitle && input.conversationId) {
      const open = await prisma.notification.findFirst({
        where: { recipientId, type: input.type, conversationId: input.conversationId, isRead: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, groupCount: true },
      });
      if (open) {
        const count = open.groupCount + 1;
        // Re-arming pushedAt sends one fresh push carrying the latest message;
        // the phone replaces the previous one (same tag) instead of stacking.
        return prisma.notification.update({
          where: { id: open.id },
          data: {
            title: pack(input.foldTitle(count)),
            body: resolved.body,
            actorName: input.actorName ?? null,
            groupCount: count,
            createdAt: new Date(),
            pushedAt: null,
          },
        });
      }
    }

    try {
      return await prisma.notification.create({
        data: {
          recipientId,
          teamId: input.teamId ?? null,
          type: input.type,
          priority: resolved.priority,
          title: pack(input.foldTitle ? input.foldTitle(1) : input.title),
          body: resolved.body,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          actorId: input.actorId ?? null,
          actorName: input.actorName ?? null,
          url: resolved.url,
          dedupeKey: input.dedupeKey ?? null,
        },
      });
    } catch (err) {
      // Already notified this person about this exact thing.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** AI lead alerts: the assigned agent, or the whole team when unassigned. */
  async create(input: CreateNotificationInput): Promise<void> {
    const recipients = await conversationRecipients(input.teamId, input.assignedTo);
    await this.notify({
      type: input.type,
      priority: input.priority,
      recipients,
      title: { en: input.titleEn, ar: input.titleAr },
      body: input.bodyEn || input.bodyAr ? { en: input.bodyEn ?? '', ar: input.bodyAr ?? '' } : null,
      contactId: input.contactId,
      conversationId: input.conversationId,
      teamId: input.teamId,
    });
  }

  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const rows = await prisma.notification.findMany({
      where: { recipientId: userId, ...(opts.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 30, 100),
    });
    return rows.map(serialize);
  }

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { recipientId: userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    // Scope by recipientId so a user can only mark their own notifications.
    await prisma.notification.updateMany({
      where: { id, recipientId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Opening a chat clears its message notifications — the person has seen them. */
  async markConversationRead(userId: string, conversationId: string): Promise<number> {
    const { count } = await prisma.notification.updateMany({
      where: { recipientId: userId, conversationId, type: 'MESSAGE', isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return count;
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async getPreferences(userId: string): Promise<{ off: NotifyCategory[] }> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const off = switchedOff(user?.notificationPrefs ?? null);
    return { off: NOTIFY_CATEGORIES.filter((c) => off.has(c)) };
  }

  async setPreferences(userId: string, off: string[]): Promise<{ off: NotifyCategory[] }> {
    const clean = NOTIFY_CATEGORIES.filter((c) => off.includes(c));
    await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: { off: clean } } });
    return { off: clean };
  }
}

function serialize(n: {
  id: string;
  type: NotificationType;
  priority: Priority;
  title: string;
  body: string | null;
  contactId: string | null;
  conversationId: string | null;
  actorName: string | null;
  url: string | null;
  groupCount: number;
  isRead: boolean;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    priority: n.priority,
    title: unpackBilingual(n.title),
    body: n.body ? unpackBilingual(n.body) : null,
    contactId: n.contactId,
    conversationId: n.conversationId,
    actorName: n.actorName,
    url: n.url ?? (n.conversationId ? conversationUrl(n.conversationId) : null),
    groupCount: n.groupCount,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

export const notificationsService = new NotificationsService();
