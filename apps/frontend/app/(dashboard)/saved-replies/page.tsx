'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page';
import { Plus, Trash2, MessageSquareReply, AtSign } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { useRemembered } from '@/hooks/useRemembered';
import { useLiveData } from '../../../hooks/useLiveData';

interface SavedReply {
  id: string;
  shortcut: string;
  message: string;
  createdAt: string;
}

export default function SavedRepliesPage() {
  const { t } = useTranslation(['settings', 'common']);
  const { status } = useSession();
  const [savedReplies, setSavedReplies, firstSavedReplies] = useRemembered<SavedReply[]>('saved-replies', []);
  const [shortcut, setShortcut] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(firstSavedReplies);
  const [error, setError] = useState<string | null>(null);

  const fetchReplies = useCallback(async () => {
    try {
      const data = await api.get('/api/saved-replies');
      setSavedReplies(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch saved replies:', err);
      setSavedReplies([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useLiveData('saved-replies', fetchReplies);

  useEffect(() => {
    if (status === 'authenticated') {
      void fetchReplies();
    }
  }, [fetchReplies, status]);

  const handleSave = async () => {
    try {
      setError(null);
      if (!shortcut.trim() || !message.trim()) {
        setError('Shortcut and message are required.');
        return;
      }

      await api.post('/api/saved-replies', {
        shortcut: shortcut.trim().startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`,
        message: message.trim(),
      });

      setShortcut('');
      setMessage('');
      await fetchReplies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reply');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await api.delete(`/api/saved-replies/${id}`);
      await fetchReplies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete reply');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader className="mb-0" title={t('settings:savedReplies.title')} description={t('settings:savedReplies.description')} />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-xl border border-white/10 bg-surface p-5">
          <h2 className="text-lg font-semibold text-ink">{t('settings:savedReplies.saveReply')}</h2>
          <p className="mt-1 text-sm text-ink-3">{t('settings:savedReplies.description')}</p>

          {error && (
            <div className="mt-4 rounded-xl border border-red-300 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-ink-3">{t('common:labels.shortcut')}</span>
              <div className="relative">
                <AtSign className="absolute left-3 top-3.5 h-4 w-4 text-ink-4" />
                <input
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                  placeholder={t('settings:savedReplies.shortcutPlaceholder')}
                  className="w-full rounded-xl border border-line bg-white dark:bg-raised py-3 pl-10 pr-4 text-sm text-ink placeholder:text-ink-4"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-ink-3">{t('common:labels.message')}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('settings:savedReplies.messagePlaceholder')}
                rows={6}
                className="w-full rounded-xl border border-line bg-white dark:bg-raised px-4 py-3 text-sm text-ink placeholder:text-ink-4"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {['{{name}}', '{{phone}}'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMessage((m) => m + v)}
                    className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20 transition-colors"
                  >
                    {v}
                  </button>
                ))}
                <span className="self-center text-xs text-ink-4">{t('templates:builder.variables')}</span>
              </div>
            </label>

            <button
              type="button"
              onClick={handleSave}
              className="btn btn-primary inline-flex"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('settings:savedReplies.saveReply')}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">{t('settings:savedReplies.title')}</h2>
              <p className="text-sm text-ink-3">{t('chat:composer.savedReplies')}</p>
            </div>
            <div className="rounded-full border border-line bg-white dark:bg-raised px-3 py-1.5 text-xs text-ink-3">
              {savedReplies.length}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {savedReplies.map((reply) => (
              <div key={reply.id} className="rounded-xl border border-line bg-white dark:bg-raised p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{reply.shortcut}</p>
                    <p className="mt-1 line-clamp-3 text-sm leading-6 text-ink-3">
                      {reply.message.replace(/\{\{(\w+)\}\}/g, (_, k) => `[${k}]`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(reply.id)}
                    className="btn btn-secondary btn-sm inline-flex shrink-0"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t('common:actions.delete')}
                  </button>
                </div>
              </div>
            ))}

            {!loading && savedReplies.length === 0 && (
              <div className="rounded-xl border border-dashed border-line bg-white dark:bg-raised p-6 text-sm text-ink-3">
                {t('settings:savedReplies.noReplies')}
              </div>
            )}
          </div>
        </section>
      </div>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
