'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trash2, Loader2, StickyNote, Send } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';

interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string };
}

interface InternalNotesProps {
  conversationId: string;
}

export default function InternalNotes({ conversationId }: InternalNotesProps) {
  const { t } = useTranslation('chat');
  const { data: session } = useSession();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentUserId = (session?.user as { id?: string } | undefined)?.id;

  const fetchNotes = useCallback(async () => {
    try {
      const data = await api.get(`/api/conversations/${conversationId}/notes`);
      setNotes(Array.isArray(data) ? data : []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    fetchNotes();
  }, [fetchNotes]);

  useSocket(
    'note:new',
    useCallback(
      (data: any) => {
        if (data.conversationId === conversationId) {
          setNotes((prev) => [...prev, data.note]);
        }
      },
      [conversationId],
    ),
  );

  useSocket(
    'note:deleted',
    useCallback(
      (data: any) => {
        if (data.conversationId === conversationId) {
          setNotes((prev) => prev.filter((n) => n.id !== data.noteId));
        }
      },
      [conversationId],
    ),
  );

  const addNote = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/conversations/${conversationId}/notes`, { body: body.trim() });
      setBody('');
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    try {
      await api.delete(`/api/conversations/${conversationId}/notes/${noteId}`);
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addNote();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-ink">{t('details.notes')}</h3>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {t('details.notesPrivate')}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-3">
          {t('details.notesSubtitle')}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <StickyNote className="mb-3 h-8 w-8 text-gray-300 dark:text-white/20" />
            <p className="text-sm font-medium text-ink-3">{t('details.notesEmpty')}</p>
            <p className="mt-1 text-xs text-ink-4/70">
              {t('details.notesEmptyHint')}
            </p>
          </div>
        )}
        {notes.map((note) => {
          const isOwn = note.author.id === currentUserId;
          return (
            <div
              key={note.id}
              className="group rounded-xl border border-amber-200/60 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-white">
                    {(note.author.name || note.author.email).charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-xs font-semibold text-amber-800 dark:text-amber-300">
                    {note.author.name || note.author.email}
                  </span>
                  <span dir="ltr" className="shrink-0 text-xs text-amber-600/70 dark:text-amber-400/50">
                    {new Date(note.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {isOwn && (
                  <button
                    type="button"
                    onClick={() => deleteNote(note.id)}
                    className="hidden shrink-0 rounded p-1 text-amber-600/50 transition hover:bg-amber-200/50 hover:text-red-600 group-hover:block dark:hover:bg-amber-500/20"
                    aria-label={t('details.notesDeleteLabel')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink/80">{note.body}</p>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('details.notesPlaceholder')}
            rows={2}
            className="field flex-1 resize-none"
          />
          <button
            type="button"
            onClick={addNote}
            disabled={!body.trim() || saving}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('details.notesAddLabel')}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
