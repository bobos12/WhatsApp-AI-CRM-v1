import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ConversationsService } from '../../conversations/conversations.service';
import { NotesService } from '../../conversations/notes.service';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { getOrCreateConversationByPhone } from '../../conversations/conversation-resolver';
import interactiveMessageService from '../../services/interactive-message.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const uploadsDir = path.resolve(process.cwd(), 'uploads');

router.use(authMiddleware);

// ── List conversations ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, search, assignedTo, view, teamId, limit } = req.query;
    const user = (req as any).user;

    const conversations = await ConversationsService.getConversations({
      status: status as string,
      search: search as string,
      assignedTo:
        assignedTo === 'me'
          ? user?.id
          : typeof assignedTo === 'string' && assignedTo.trim()
          ? assignedTo
          : undefined,
      view: view as any,
      teamId: teamId as string,
      currentUserId: user?.id,
      currentUserTeamId: user?.teamId,
      limit: limit ? Math.min(Number(limit), 200) : undefined,
    });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Get single conversation (no messages — use /messages endpoint) ──────────
router.get('/by-phone/:phone', async (req, res) => {
  try {
    const result = await getOrCreateConversationByPhone(req.params.phone, (req as any).user?.teamId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const conversation = await ConversationsService.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Paginated messages ───────────────────────────────────────────────────────
// GET /conversations/:id/messages?limit=50&cursor=<messageId>
router.get('/:id/messages', async (req, res) => {
  try {
    const { cursor, limit } = req.query;
    const result = await ConversationsService.getMessages(
      req.params.id,
      cursor as string | undefined,
      limit ? Number(limit) : 50,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Message search ──────────────────────────────────────────────────────────
router.get('/:id/messages/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const { prisma } = await import('../../lib/prisma');
    const messages = await prisma.message.findMany({
      where: {
        conversationId: req.params.id,
        body: { contains: q.trim(), mode: 'insensitive' },
      },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Status ───────────────────────────────────────────────────────────────────
router.put('/:id/status', checkPermission('update', 'conversations'), async (req, res) => {
  try {
    const { status } = req.body;
    const user = (req as any).user;
    const conversation = await ConversationsService.updateConversationStatus(req.params.id, status, user?.id);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Read ─────────────────────────────────────────────────────────────────────
router.put('/:id/read', async (req, res) => {
  try {
    const conversation = await ConversationsService.markAsRead(req.params.id);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Assign agent ─────────────────────────────────────────────────────────────
router.put('/:id/assign', checkPermission('update', 'conversations'), async (req, res) => {
  try {
    const { agentId } = req.body;
    const user = (req as any).user;
    const conversation = await ConversationsService.assignConversation(req.params.id, agentId || null, user?.id);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Assign team ───────────────────────────────────────────────────────────────
router.put('/:id/assign-team', checkPermission('update', 'conversations'), async (req, res) => {
  try {
    const { teamId } = req.body;
    const user = (req as any).user;
    const conversation = await ConversationsService.assignTeam(req.params.id, teamId || null, user?.id);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Pipeline ──────────────────────────────────────────────────────────────────
router.put('/:id/pipeline', checkPermission('update', 'conversations'), async (req, res) => {
  try {
    const { pipeline } = req.body;
    const user = (req as any).user;
    const conversation = await ConversationsService.updatePipeline(req.params.id, pipeline || null, user?.id);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Pin / Unpin ───────────────────────────────────────────────────────────────
router.put('/:id/pin', async (req, res) => {
  try {
    const { isPinned } = req.body;
    const conversation = await ConversationsService.pinConversation(req.params.id, Boolean(isPinned));
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Snooze ────────────────────────────────────────────────────────────────────
// Body: { snoozedUntil: ISO string } to snooze, or { snoozedUntil: null } to unsnooze
router.put('/:id/snooze', async (req, res) => {
  try {
    const { snoozedUntil } = req.body;
    const date = snoozedUntil ? new Date(snoozedUntil) : null;
    if (snoozedUntil && isNaN(date!.getTime())) {
      return res.status(400).json({ error: 'Invalid snoozedUntil date' });
    }
    const conversation = await ConversationsService.snoozeConversation(req.params.id, date);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── AI Bot per-conversation override (tri-state) ──────────────────────────────
// Accepts `botOverride`: true (force bot ON), false (force OFF), or null (Auto —
// follow the global targeting rules). Legacy `botEnabled` boolean is still
// accepted for back-compat and maps to true/null.
router.put('/:id/bot', async (req, res) => {
  try {
    const body = req.body as { botOverride?: boolean | null; botEnabled?: boolean };
    const { prisma } = await import('../../lib/prisma');

    let botOverride: boolean | null;
    if ('botOverride' in body) {
      botOverride = body.botOverride === null ? null : Boolean(body.botOverride);
    } else {
      // Legacy callers: botEnabled=true → force on, false → Auto (follow rules).
      botOverride = body.botEnabled ? true : null;
    }

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        botOverride,
        // Keep the legacy column in sync for older readers.
        botEnabled: botOverride === true,
        // Clear any human-handoff pause when forcing the bot ON.
        ...(botOverride === true ? { botPausedUntil: null } : {}),
      },
      select: { id: true, botOverride: true, botEnabled: true, botPausedUntil: true },
    });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── AI Bot simulate — create real inbound bubble + bot reply in chat ──────────
router.post('/:id/bot/simulate', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
    const { prisma } = await import('../../lib/prisma');
    const { emitRealtime } = await import('../../realtime/socket');
    const { aiBotService } = await import('../../services/ai-bot.service');

    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { contact: true },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const phone = conv.contact?.phone || '';
    const sessionId = process.env.WHATSAPP_SESSION_ID || 'default';
    const externalId = `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Save fake inbound message so it appears in chat
    const inbound = await prisma.message.create({
      data: {
        externalId,
        sessionId,
        direction: 'INBOUND',
        from: phone,
        to: sessionId,
        phone,
        conversationId: conv.id,
        fromMe: false,
        body: message.trim(),
        type: 'TEXT',
        timestamp: new Date(),
        status: 'PROCESSED',
      },
    });

    emitRealtime('message:new', {
      conversationId: conv.id,
      message: { ...inbound, sequenceNumber: Number(inbound.sequenceNumber), reactions: [] },
    }, conv.teamId ?? null);

    // Generate bot reply
    const provider = (aiBotService as any).defaultProvider();
    if (!provider) return res.json({ reply: null });

    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: { fromMe: true, body: true },
    });

    const reply = await provider.generateReply({
      conversationId: conv.id,
      phone,
      teamId: conv.teamId,
      inboundText: message.trim(),
      recentMessages: recentMessages.reverse(),
    });

    if (!reply) return res.json({ reply: null });

    // Try to send via WhatsApp (real delivery); fall back to DB-only if WA is offline
    try {
      const { providerManager } = await import('../../providers/manager');
      await providerManager.sendMessage({ phone, text: reply, conversationId: conv.id });
    } catch {
      // WhatsApp not connected — persist locally so the reply still shows in chat
      const botMsg = await prisma.message.create({
        data: {
          externalId: `sim-bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sessionId,
          direction: 'OUTBOUND',
          from: sessionId,
          to: phone,
          phone,
          conversationId: conv.id,
          fromMe: true,
          body: reply,
          type: 'TEXT',
          timestamp: new Date(),
          status: 'SENT',
        },
      });
      emitRealtime('message:new', {
        conversationId: conv.id,
        message: { ...botMsg, sequenceNumber: Number(botMsg.sequenceNumber), reactions: [] },
      }, conv.teamId ?? null);
    }

    return res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── AI Bot test — reply to a message without sending to WhatsApp ──────────────
router.post('/:id/bot/test', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
    const { prisma } = await import('../../lib/prisma');
    const { aiBotService } = await import('../../services/ai-bot.service');
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { id: true, teamId: true },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: { fromMe: true, body: true },
    });
    // Call provider directly without sending to WhatsApp
    const provider = (aiBotService as any).defaultProvider();
    if (!provider) return res.status(503).json({ error: 'No AI provider registered' });
    const reply = await provider.generateReply({
      conversationId: conv.id,
      phone: '',
      teamId: conv.teamId,
      inboundText: message.trim(),
      recentMessages: recentMessages.reverse(),
    });
    res.json({ reply: reply || '' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── AI Bot resume (clear pause) ───────────────────────────────────────────────
router.put('/:id/bot/resume', async (req, res) => {
  try {
    const { prisma } = await import('../../lib/prisma');
    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { botPausedUntil: null },
      select: { id: true, botEnabled: true, botPausedUntil: true },
    });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Internal notes ────────────────────────────────────────────────────────────
router.get('/:id/notes', async (req, res) => {
  try {
    const notes = await NotesService.getNotes(req.params.id);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/:id/notes', async (req, res) => {
  try {
    const { body } = req.body;
    const user = (req as any).user;
    if (!body?.trim()) return res.status(400).json({ error: 'Note body is required' });
    const note = await NotesService.addNote(req.params.id, user.id, body.trim());
    res.status(201).json(note);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await NotesService.deleteNote(req.params.noteId, user.id, user.role);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(message === 'Forbidden' ? 403 : 500).json({ error: message });
  }
});

// ── Message reactions ─────────────────────────────────────────────────────────
router.post('/:id/messages/:messageId/reactions', async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = (req as any).user?.id;
    if (!emoji || !userId) return res.status(400).json({ error: 'emoji and auth required' });

    const { prisma } = await import('../../lib/prisma');
    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_userId: { messageId: req.params.messageId, userId } },
    });

    let reactionEmoji = emoji;
    if (existing) {
      if (existing.emoji === emoji) {
        await prisma.messageReaction.delete({ where: { id: existing.id } });
        reactionEmoji = '';
      } else {
        await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
      }
    } else {
      await prisma.messageReaction.create({ data: { messageId: req.params.messageId, userId, emoji } });
    }

    // Sync reaction to WhatsApp
    try {
      const { providerManager } = await import('../../providers/manager');
      const msg = await prisma.message.findUnique({
        where: { id: req.params.messageId },
        select: { externalId: true, fromMe: true },
      });
      const conv = await prisma.conversation.findUnique({
        where: { id: req.params.id },
        include: { contact: true },
      });
      if (msg?.externalId && conv?.contact?.phone) {
        await providerManager.sendReaction(conv.contact.phone, msg.externalId, msg.fromMe, reactionEmoji);
      }
    } catch {
      // non-critical — DB already updated
    }

    const reactions = await prisma.messageReaction.findMany({
      where: { messageId: req.params.messageId },
      include: { user: { select: { id: true, name: true } } },
    });

    const { emitRealtime } = await import('../../realtime/socket');
    const { emitEvent } = await import('../../realtime/event-bus');
    const conv = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { teamId: true } });

    // Legacy event
    emitRealtime('message:reaction', { conversationId: req.params.id, messageId: req.params.messageId, reactions }, conv?.teamId ?? null);

    // Envelope event — Zustand store applies replace semantics on the full array
    if (conv?.teamId) {
      emitEvent('message.reaction_changed', {
        conversationId: req.params.id,
        messageId: req.params.messageId,
        reactions: reactions
          .filter((r: any) => r.emoji)
          .map((r: any) => ({
            emoji: r.emoji,
            reactor: { kind: 'user' as const, userId: r.userId ?? '' },
          })),
      }, conv.teamId);
    }

    res.json(reactions);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Send reply ────────────────────────────────────────────────────────────────
router.post('/:id/reply', checkPermission('create', 'messages'), upload.single('media'), async (req, res) => {
  try {
    const { message, contactId, mediaCaption, replyToId, replyToBody, clientId } = req.body;
    const agentId = (req as any).user?.id as string | undefined;
    const hasMedia = Boolean(req.file);
    if ((!message || !String(message).trim()) && !hasMedia) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    let mediaInfo;
    if (req.file) {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const ext = path.extname(req.file.originalname) || '';
      const isVoiceNote = req.file.mimetype.startsWith('audio/') && req.file.originalname.startsWith('voice-note-');
      const fileName = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(uploadsDir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      mediaInfo = {
        mediaBuffer: req.file.buffer,
        mediaMimeType: req.file.mimetype,
        mediaFileName: req.file.originalname,
        mediaCaption: mediaCaption ?? message ?? '',
        mediaUrl: `/uploads/${fileName}`,
        mediaIsVoiceNote: isVoiceNote,
      };
    }

    await ConversationsService.sendReply(
      req.params.id,
      message,
      contactId,
      req.file
        ? {
            mediaBuffer: mediaInfo!.mediaBuffer,
            mediaMimeType: mediaInfo!.mediaMimeType,
            mediaFileName: mediaInfo!.mediaFileName,
            mediaCaption: mediaInfo!.mediaCaption,
            mediaIsVoiceNote: mediaInfo!.mediaIsVoiceNote,
            mediaUrl: mediaInfo!.mediaUrl,
          }
        : undefined,
      replyToId ? { replyToId, replyToBody } : undefined,
      clientId ?? undefined,
      agentId,
    );
    res.json({ success: true, clientId: clientId ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to send conversation reply:', error);

    // Handle warm-up limit errors (return 429)
    if ((error as any)?.code === 'WARMUP_DAILY_LIMIT') {
      const err = error as any;
      return res.status(429).json({
        error: message,
        code: 'WARMUP_DAILY_LIMIT',
        limit: err.limit,
        sent: err.sent,
        phaseName: err.phaseName,
        resetAt: err.resetAt,
        fullyUnlockedAt: err.fullyUnlockedAt,
        dayNumber: err.dayNumber,
      });
    }

    const status = message.includes('not connected') ? 503 : 500;
    res.status(status).json({ error: message });
  }
});

// ── Send interactive message (Baileys) ───────────────────────────────────────
router.post('/:id/interactive', checkPermission('create', 'messages'), async (req, res) => {
  try {
    const { content, clientId } = req.body;
    const agentId = (req as any).user?.id as string | undefined;
    const VALID_KINDS = ['interactive_buttons', 'interactive_list', 'interactive_cta', 'interactive_carousel'];
    if (!content?.kind || !VALID_KINDS.includes(content.kind)) {
      return res.status(400).json({ error: `content.kind must be one of: ${VALID_KINDS.join(' | ')}` });
    }

    const { prisma } = await import('../../lib/prisma');
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { contact: true },
    });
    if (!conv?.contact?.phone) return res.status(404).json({ error: 'Conversation or contact not found' });

    // Native Cloud API interactive: real tappable buttons and list sheets,
    // rather than the numbered-text menu the WhatsApp Web protocol forced.
    const { messageId } = await interactiveMessageService.send(
      conv.contact.phone,
      content,
      { conversationId: req.params.id, clientId: clientId ?? undefined },
    );

    // Auto-assign to the sending agent if the conversation has no assigned agent
    if (agentId && !conv.assignedTo) {
      await ConversationsService.assignConversation(req.params.id, agentId, agentId);
    }

    res.json({ success: true, messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to send interactive message:', error);

    // Handle warm-up limit errors (return 429)
    if ((error as any)?.code === 'WARMUP_DAILY_LIMIT') {
      const err = error as any;
      return res.status(429).json({
        error: message,
        code: 'WARMUP_DAILY_LIMIT',
        limit: err.limit,
        sent: err.sent,
        phaseName: err.phaseName,
        resetAt: err.resetAt,
        fullyUnlockedAt: err.fullyUnlockedAt,
        dayNumber: err.dayNumber,
      });
    }

    const status = message.includes('not connected') ? 503 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;
