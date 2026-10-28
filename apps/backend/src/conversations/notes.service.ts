import { prisma } from '../lib/prisma';
import { emitRealtime } from '../realtime/socket';
import { notifyNoteAdded } from '../notifications/events';

export class NotesService {
  static async getNotes(conversationId: string) {
    return prisma.internalNote.findMany({
      where: { conversationId },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  static async addNote(conversationId: string, authorId: string, body: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, teamId: true },
    });
    if (!conversation) throw new Error('Conversation not found');

    const note = await prisma.internalNote.create({
      data: { conversationId, authorId, body },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    emitRealtime('note:new', { conversationId, note }, conversation.teamId);
    void notifyNoteAdded({ conversationId, noteId: note.id, authorId, body });
    return note;
  }

  static async deleteNote(noteId: string, requesterId: string, requesterRole: string) {
    const note = await prisma.internalNote.findUnique({
      where: { id: noteId },
      include: { conversation: { select: { teamId: true } } },
    });
    if (!note) throw new Error('Note not found');

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'].includes(requesterRole);
    if (note.authorId !== requesterId && !isAdmin) throw new Error('Forbidden');

    await prisma.internalNote.delete({ where: { id: noteId } });
    emitRealtime('note:deleted', { conversationId: note.conversationId, noteId }, note.conversation.teamId);
    return { success: true };
  }
}
