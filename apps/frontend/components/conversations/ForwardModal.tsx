'use client';

import { useEffect, useState } from 'react';
import { X, Search, Send, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, apiForm } from '@/lib/api';
import { Modal } from '@/components/ui/modal';

interface Conversation {
  id: string;
  contact: { name: string | null; phone: string };
  lastMessage: string | null;
}

interface ForwardModalProps {
  message: any;
  onClose: () => void;
  onForwarded?: () => void;
}

export default function ForwardModal({ message, onClose, onForwarded }: ForwardModalProps) {
  const { t } = useTranslation('chat');
  const { t: tc } = useTranslation('common');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract message text and media info
  const messageText = message?.body ||
    (message?.renderable?.blocks
      ?.filter((b: any) => b.type === 'body_text')
      .map((b: any) => b.text)
      .join('\n') || '');

  const mediaBlock = message?.renderable?.blocks?.find((b: any) => b.type === 'media');
  const mediaUrl = mediaBlock?.media?.url;
  const mediaMime = mediaBlock?.media?.mime;
  const mediaFileName = mediaBlock?.media?.fileName;
  const hasMedia = !!mediaUrl;

  useEffect(() => {
    api.get('/api/conversations?status=OPEN')
      .then((data) => setConversations(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const filtered = conversations.filter((c) => {
    const name = c.contact?.name?.toLowerCase() ?? '';
    const phone = c.contact?.phone ?? '';
    const q = search.toLowerCase();
    return name.includes(q) || phone.includes(q);
  });

  async function handleForward() {
    if (!selected) return;
    if (!hasMedia && !messageText.trim()) return;

    setSending(true);
    setError(null);
    try {
      if (hasMedia && mediaUrl) {
        // Forward with media
        const mediaResponse = await fetch(mediaUrl);
        if (!mediaResponse.ok) throw new Error('Failed to fetch media');
        const blob = await mediaResponse.blob();

        const formData = new FormData();
        const fileName = mediaFileName || `media.${blob.type.split('/')[1]}`;
        formData.append('media', blob, fileName);
        formData.append('message', messageText);
        formData.append('mediaCaption', messageText);

        await apiForm(`/api/conversations/${selected}/reply`, formData);
      } else {
        // Forward text only
        await api.post(`/api/conversations/${selected}/reply`, { message: messageText });
      }

      setDone(true);
      onForwarded?.();
      setTimeout(onClose, 800);
    } catch (err: any) {
      setError(err?.message || err?.data?.error || t('forwardModal.sendFailed'));
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label={t('forwardModal.title')}
      overlayClassName="bg-black/60"
      className="w-full max-w-md rounded-xl border border-line bg-surface shadow-xl overflow-hidden"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink">{t('forwardModal.title')}</h2>
          <button type="button" onClick={onClose} aria-label={tc('actions.close')} className="rounded-lg p-1.5 text-gray-400 hover:bg-raised transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Preview */}
        <div className="mx-5 mt-4 rounded-xl bg-raised border border-line px-3 py-2">
          <p className="text-xs text-ink-3 mb-1">{t('forwardModal.forwarding')}</p>
          {hasMedia ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-ink-2">
                📎 {mediaFileName || 'Media file'}
              </p>
              {messageText && (
                <p className="text-sm text-ink-2 truncate">{messageText}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink truncate">{messageText}</p>
          )}
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={t('forwardModal.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={sending}
              className="field w-full pl-9 pr-3 disabled:opacity-60"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="max-h-52 overflow-y-auto px-5 pb-4 space-y-1">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-4">{t('forwardModal.noConversations')}</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              disabled={sending}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-60 disabled:cursor-default ${
                selected === c.id
                  ? 'bg-brand/10 border border-brand/30'
                  : 'hover:bg-raised border border-transparent'
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                {(c.contact?.name || c.contact?.phone || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {c.contact?.name || c.contact?.phone}
                </p>
                {c.lastMessage && (
                  <p className="truncate text-xs text-ink-3">{c.lastMessage}</p>
                )}
              </div>
              {selected === c.id && (
                <span className="ml-auto shrink-0 text-brand text-lg">✓</span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-xl border border-line px-4 py-2 text-sm text-ink-3 hover:bg-raised transition-colors disabled:opacity-60"
          >
            {t('forwardModal.cancel')}
          </button>
          <button
            type="button"
            disabled={!selected || sending || done}
            onClick={handleForward}
            className="btn btn-primary inline-flex disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {done ? t('forwardModal.forwarded') : sending ? t('forwardModal.sending') : t('forwardModal.forward')}
          </button>
        </div>
    </Modal>
  );
}
