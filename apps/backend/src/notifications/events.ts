import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { conversationRecipients, notificationsService } from './notifications.service';

/**
 * Every CRM event that notifies someone, in one place: who hears about it and
 * what it says, in both languages. Each helper is fire-and-forget safe — a
 * failed notification must never fail the action that caused it.
 */

const PREVIEW_MAX = 140;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

async function userName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? null;
}

function contactLabel(contact: { name: string | null; phone: string } | null | undefined): string {
  return contact?.name?.trim() || contact?.phone || 'a customer';
}

function guard(event: string, fn: () => Promise<unknown>): Promise<void> {
  return fn().then(
    () => undefined,
    (err) => logger.warn('notify_event.failed', { event, error: err instanceof Error ? err.message : String(err) }),
  );
}

// ── Messages ────────────────────────────────────────────────────────────────

/** A customer wrote in: the assigned agent, or the team while unassigned. */
export function notifyInboundMessage(args: { conversationId: string; preview: string; senderName?: string | null }) {
  return guard('message', async () => {
    // Read assignment now, not from the snapshot taken before auto-assign ran.
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { teamId: true, assignedTo: true, contactId: true, contact: { select: { name: true, phone: true } } },
    });
    if (!conv) return;
    const name = conv.contact?.name?.trim() || args.senderName?.trim() || conv.contact?.phone || 'Customer';
    const preview = clip(args.preview) || 'Sent a message';
    await notificationsService.notify({
      type: 'MESSAGE',
      recipients: await conversationRecipients(conv.teamId, conv.assignedTo),
      actorName: name,
      // WhatsApp-style: the customer's name, then their latest message.
      title: { en: name, ar: name },
      foldTitle: () => ({ en: name, ar: name }),
      body: { en: preview, ar: preview },
      contactId: conv.contactId,
      conversationId: args.conversationId,
      teamId: conv.teamId,
    });
  });
}

// ── Assignments ─────────────────────────────────────────────────────────────

/** A chat was handed to someone (by a teammate, or automatically when actorId is null). */
export function notifyConversationAssigned(args: { conversationId: string; assigneeId: string; actorId?: string | null }) {
  return guard('conversation_assigned', async () => {
    const [conv, actorName] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: args.conversationId },
        select: { teamId: true, contactId: true, lastMessagePreview: true, contact: { select: { name: true, phone: true } } },
      }),
      userName(args.actorId),
    ]);
    if (!conv) return;
    const customer = contactLabel(conv.contact);
    const preview = conv.lastMessagePreview ? clip(conv.lastMessagePreview) : '';
    await notificationsService.notify({
      type: 'ASSIGNMENT',
      recipients: [args.assigneeId],
      actorId: args.actorId ?? null,
      actorName: actorName ?? customer,
      title: actorName
        ? { en: `${actorName} assigned you a chat with ${customer}`, ar: `أسند إليك ${actorName} محادثة ${customer}` }
        : { en: `New chat assigned to you: ${customer}`, ar: `محادثة جديدة أُسندت إليك: ${customer}` },
      body: preview ? { en: preview, ar: preview } : null,
      contactId: conv.contactId,
      conversationId: args.conversationId,
      teamId: conv.teamId,
    });
  });
}

export function notifyTaskAssigned(args: {
  task: { id: string; title: string; dueDate?: Date | string | null; teamId?: string | null };
  assigneeId: string;
  actorId: string;
}) {
  return guard('task_assigned', async () => {
    const actorName = (await userName(args.actorId)) ?? 'A teammate';
    const title = clip(args.task.title);
    await notificationsService.notify({
      type: 'ASSIGNMENT',
      recipients: [args.assigneeId],
      actorId: args.actorId,
      actorName,
      title: { en: `${actorName} assigned you a task`, ar: `أسند إليك ${actorName} مهمة` },
      body: { en: title, ar: title },
      url: '/tasks',
      teamId: args.task.teamId ?? null,
      dedupeKey: `task-assigned:${args.task.id}:${args.assigneeId}`,
    });
  });
}

// ── Internal notes: mentions, replies, comments ─────────────────────────────

/** "@Farah" or "@Farah Ali" — matched against teammates' first or full names. */
export function mentionedUserIds(body: string, people: { id: string; name: string }[]): Set<string> {
  const text = ` ${body.toLowerCase()}`;
  const found = new Set<string>();
  for (const p of people) {
    const full = p.name.trim().toLowerCase();
    if (!full) continue;
    const first = full.split(/\s+/)[0];
    for (const candidate of new Set([full, first])) {
      const at = text.indexOf(`@${candidate}`);
      if (at === -1) continue;
      const next = text.charAt(at + candidate.length + 1);
      // Whole-word match: "@sara" must not fire for "@sarah".
      if (!next || !/[\p{L}\p{N}_]/u.test(next)) { found.add(p.id); break; }
    }
  }
  return found;
}

/**
 * A teammate left a note on a chat. Mentioned people hear "mentioned you",
 * earlier participants in the note thread hear "replied", and the chat's owner
 * hears "added a note" — each person once, at the most specific level.
 */
export function notifyNoteAdded(args: { conversationId: string; noteId: string; authorId: string; body: string }) {
  return guard('note_added', async () => {
    const [conv, author, teammates, earlier] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: args.conversationId },
        select: { teamId: true, assignedTo: true, contactId: true, contact: { select: { name: true, phone: true } } },
      }),
      prisma.user.findUnique({ where: { id: args.authorId }, select: { name: true } }),
      args.body.includes('@') ? prisma.user.findMany({ select: { id: true, name: true } }) : [],
      prisma.internalNote.findMany({
        where: { conversationId: args.conversationId, id: { not: args.noteId } },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
    ]);
    if (!conv) return;
    const who = author?.name ?? 'A teammate';
    const customer = contactLabel(conv.contact);
    const snippet = clip(args.body);
    const common = {
      actorId: args.authorId,
      actorName: who,
      body: { en: snippet, ar: snippet },
      contactId: conv.contactId,
      conversationId: args.conversationId,
      teamId: conv.teamId,
    };

    const mentioned = mentionedUserIds(args.body, teammates);
    const repliedTo = new Set(earlier.map((n) => n.authorId).filter((id) => !mentioned.has(id)));
    const owner = conv.assignedTo && !mentioned.has(conv.assignedTo) && !repliedTo.has(conv.assignedTo) ? conv.assignedTo : null;

    await Promise.all([
      notificationsService.notify({
        ...common,
        type: 'MENTION',
        recipients: [...mentioned],
        title: { en: `${who} mentioned you in a note on ${customer}`, ar: `أشار إليك ${who} في ملاحظة على ${customer}` },
        dedupeKey: `note:${args.noteId}`,
      }),
      notificationsService.notify({
        ...common,
        type: 'MENTION',
        recipients: [...repliedTo],
        title: { en: `${who} replied in the notes on ${customer}`, ar: `ردّ ${who} في ملاحظات ${customer}` },
        dedupeKey: `note:${args.noteId}`,
      }),
      owner
        ? notificationsService.notify({
            ...common,
            type: 'NOTE',
            recipients: [owner],
            title: { en: `${who} added a note on ${customer}`, ar: `أضاف ${who} ملاحظة على ${customer}` },
            dedupeKey: `note:${args.noteId}`,
          })
        : null,
    ]);
  });
}

// ── Reminders ───────────────────────────────────────────────────────────────

/** A snoozed chat came back. */
export function notifySnoozeEnded(args: { conversationId: string; snoozedUntil: Date }) {
  return guard('snooze_ended', async () => {
    const conv = await prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { teamId: true, assignedTo: true, contactId: true, contact: { select: { name: true, phone: true } } },
    });
    if (!conv) return;
    const customer = contactLabel(conv.contact);
    await notificationsService.notify({
      type: 'REMINDER',
      recipients: await conversationRecipients(conv.teamId, conv.assignedTo),
      actorName: customer,
      title: { en: `Reminder: follow up with ${customer}`, ar: `تذكير: تابع مع ${customer}` },
      body: { en: 'The snooze you set has ended — the chat is back in your inbox.', ar: 'انتهى التأجيل وعادت المحادثة إلى صندوقك.' },
      contactId: conv.contactId,
      conversationId: args.conversationId,
      teamId: conv.teamId,
      dedupeKey: `snooze:${args.conversationId}:${args.snoozedUntil.toISOString()}`,
    });
  });
}
