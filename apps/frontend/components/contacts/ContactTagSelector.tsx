'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Hash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useTags } from '../../hooks/useTags';
import { useSocket } from '../../hooks/useSocket';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Props {
  contactId: string;
  initialTags?: Tag[];
  onChanged?: () => void;
}

export default function ContactTagSelector({ contactId, initialTags = [], onChanged }: Props) {
  const { t } = useTranslation('contacts');
  const allTags = useTags();                          // live list from server
  const [contactTags, setContactTags] = useState<Tag[]>(initialTags);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fetch the contact's current tag assignments on mount
  useEffect(() => {
    api
      .get(`/api/tags/contacts/${contactId}`)
      .then((d: unknown) => setContactTags(Array.isArray(d) ? (d as Tag[]) : []))
      .catch(() => {});
  }, [contactId]);

  // Real-time: sync when another session changes this contact's tags
  useSocket('contact:tag_added', useCallback((data: { contactId: string; tagId: string }) => {
    if (data.contactId !== contactId) return;
    const tag = allTags.find((t) => t.id === data.tagId);
    if (tag) setContactTags((prev) => (prev.find((t) => t.id === tag.id) ? prev : [...prev, tag]));
  }, [contactId, allTags]));

  useSocket('contact:tag_removed', useCallback((data: { contactId: string; tagId: string }) => {
    if (data.contactId !== contactId) return;
    setContactTags((prev) => prev.filter((t) => t.id !== data.tagId));
  }, [contactId]));

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addTag = async (tag: Tag) => {
    if (contactTags.find((t) => t.id === tag.id)) return;
    // Optimistic update BEFORE the await so the incoming socket event finds the tag already present
    // and its dedup check prevents adding a second copy.
    setContactTags((prev) => (prev.find((t) => t.id === tag.id) ? prev : [...prev, tag]));
    try {
      await api.post(`/api/tags/contacts/${contactId}/tags/${tag.id}`, {});
      onChanged?.();
    } catch {
      setContactTags((prev) => prev.filter((t) => t.id !== tag.id));
    }
  };

  const removeTag = async (tagId: string) => {
    // Optimistic removal first for the same reason
    setContactTags((prev) => prev.filter((t) => t.id !== tagId));
    try {
      await api.delete(`/api/tags/contacts/${contactId}/tags/${tagId}`);
      onChanged?.();
    } catch {
      // Rollback: re-fetch the contact's tags on failure
      api
        .get(`/api/tags/contacts/${contactId}`)
        .then((d: unknown) => setContactTags(Array.isArray(d) ? (d as Tag[]) : []))
        .catch(() => {});
    }
  };

  const assignedIds = new Set(contactTags.map((t) => t.id));
  const available = allTags.filter(
    (t) => !assignedIds.has(t.id) &&
      (search === '' || t.name.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div ref={ref} className="relative">
      {/* Current tags */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {contactTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: tag.color }}
          >
            {tag.name}
            <button
              type="button"
              onClick={() => removeTag(tag.id)}
              className="opacity-70 hover:opacity-100 transition-opacity"
              aria-label={`Remove ${tag.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-ink-3 hover:border-brand hover:text-brand transition-colors"
        >
          <Plus className="h-3 w-3" />
          {t('tags.addTag')}
        </button>
      </div>

      {/* Dropdown — fixed list only, no inline create */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-line bg-white dark:bg-raised shadow-lg">
          {/* Search within existing tags */}
          <div className="p-2 border-b border-line">
            <div className="relative">
              <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-4" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('tags.searchPlaceholder', { defaultValue: 'Search tags…' })}
                className="field field-sm w-full pl-8 pr-2"
              />
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto p-1">
            {allTags.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-ink-4">
                No tags yet — create them in the Tags page.
              </p>
            )}
            {allTags.length > 0 && available.length === 0 && (
              <p className="px-2 py-2 text-xs text-ink-4">
                {search ? 'No tags match your search.' : t('tags.allAssigned')}
              </p>
            )}
            {available.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => { addTag(tag); setSearch(''); }}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-raised transition-colors"
              >
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 truncate">{tag.name}</span>
                {tag._count !== undefined && (
                  <span className="text-[10px] text-ink-4">{tag._count.contacts}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
