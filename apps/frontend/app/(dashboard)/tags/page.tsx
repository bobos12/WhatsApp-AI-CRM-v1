'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hash, Users2, Filter, X, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { formatPhone } from '../../../lib/phone';
import { useRemembered } from '@/hooks/useRemembered';
import { useLiveData } from '../../../hooks/useLiveData';

interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { contacts: number };
}

interface ContactTag {
  id: string;
  name: string;
  color: string;
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
  createdAt: string;
  contactTags?: { tag: ContactTag }[];
}

const COLOR_PRESETS = ['#6366f1', '#25D366', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

export default function TagsPage() {
  const { t } = useTranslation(['common', 'chat']);
  const { status } = useSession();
  const [tags, setTags, firstTags] = useRemembered<Tag[]>('tags', []);
  const [contacts, setContacts] = useRemembered<Contact[]>('tags:contacts', []);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(firstTags);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [tagData, contactData] = await Promise.all([
        api.getCached('/api/tags', 5 * 60_000),
        api.getCached('/api/contacts?fields=basic', 5 * 60_000),
      ]);
      setTags(Array.isArray(tagData) ? tagData : []);
      setContacts(Array.isArray(contactData) ? contactData : []);
    } catch (error) {
      setTags([]);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useLiveData(['tags', 'contacts'], fetchData);

  useEffect(() => {
    if (status === 'authenticated') void fetchData();
  }, [fetchData, status]);

  const createTag = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/api/tags', { name: newName.trim(), color: newColor });
      setNewName('');
      await fetchData();
    } catch {}
    setCreating(false);
  };

  const deleteTag = async (id: string) => {
    if (!confirm(t('common:confirmDelete.message'))) return;
    try {
      await api.delete(`/api/tags/${id}`);
      if (selectedTagId === id) setSelectedTagId(null);
      await fetchData();
    } catch {}
  };

  const filteredContacts = useMemo(() => {
    if (!selectedTagId) return contacts.filter((c) => (c.contactTags?.length ?? 0) > 0);
    return contacts.filter((c) => c.contactTags?.some((ct) => ct.tag.id === selectedTagId));
  }, [contacts, selectedTagId]);

  return (
    <div className="space-y-6">
      <section className="relative">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">{t('common:labels.tags')}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-3">
            {t('chat:details.tags')}
          </p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
        {/* Left: tag management */}
        <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{t('common:labels.tags')}</h2>
            <p className="text-xs text-ink-3">{t('common:actions.filter')}</p>
          </div>

          {/* Create tag */}
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTag()}
              placeholder={t('chat:details.addTag')}
              className="field w-full"
            />
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`h-5 w-5 rounded-full transition-transform ${newColor === c ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-surface' : ''}`}
                  style={{ backgroundColor: c, '--tw-ring-color': c } as any}
                />
              ))}
              <button
                type="button"
                onClick={createTag}
                disabled={creating || !newName.trim()}
                className="btn btn-primary btn-sm ml-auto inline-flex disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('common:actions.create')}
              </button>
            </div>
          </div>

          {/* Tag list */}
          <div className="space-y-1">
            {!loading && tags.length === 0 && (
              <p className="text-sm text-ink-4">{t('common:empty.title')}</p>
            )}
            {selectedTagId && (
              <button
                type="button"
                onClick={() => setSelectedTagId(null)}
                className="mb-2 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> {t('common:actions.filter')}
              </button>
            )}
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`flex items-center justify-between rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                  selectedTagId === tag.id
                    ? 'bg-brand/10 dark:bg-brand/15'
                    : 'hover:bg-raised'
                }`}
                onClick={() => setSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  <span className="text-sm font-medium text-ink">{tag.name}</span>
                  <span className="text-xs text-ink-3">
                    {tag._count?.contacts ?? 0}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteTag(tag.id); }}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Right: contacts */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {selectedTagId
                  ? tags.find((tag) => tag.id === selectedTagId)?.name ?? ''
                  : t('common:labels.tags')}
              </h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-ink-3">
              <Users2 className="h-3.5 w-3.5" />
              {filteredContacts.length}
            </div>
          </div>

          <div className="space-y-3">
            {filteredContacts.map((contact) => {
              const ctags = contact.contactTags?.map((ct) => ct.tag) ?? [];
              return (
                <div key={contact.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-ink">{contact.name || t('common:labels.name')}</p>
                      <p className="mt-0.5 text-xs text-ink-3"><bdi>{formatPhone(contact.phone)}</bdi></p>
                    </div>
                    <a
                      href={`/conversations?phone=${encodeURIComponent(contact.phone)}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1.5 text-xs text-brand hover:bg-brand/20 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t('common:labels.message')}
                    </a>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ctags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {!loading && filteredContacts.length === 0 && (
              <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-4">
                {t('common:empty.title')}
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
