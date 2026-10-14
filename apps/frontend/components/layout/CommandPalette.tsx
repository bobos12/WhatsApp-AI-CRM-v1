'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search, CornerDownLeft, Send, Sparkles, UserPlus, Upload, FileText, Moon, Globe,
  User, MessageSquare, LayoutTemplate, Megaphone, Loader2, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { isManager } from '@/lib/roles';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useLanguage } from '@/components/providers/I18nProvider';
import { useOperatorAccess } from '@/hooks/useOperatorAccess';
import { visibleGroups, SETTINGS_ITEM } from './nav-config';

const OPEN_EVENT = 'nx:command-palette';

/** Open the palette from anywhere (sidebar search button, mobile header). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Entry {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
  keywords?: string;
}

interface SearchHit { id: string; title: string; subtitle?: string; href: string }
interface SearchResults {
  contacts?: SearchHit[];
  conversations?: SearchHit[];
  templates?: SearchHit[];
  broadcasts?: SearchHit[];
}

/**
 * ⌘K. One box that answers both "where is X" and "do X": every screen, the
 * common creation actions, and live search across contacts, chats, templates
 * and campaigns. It replaces the header search, which could only find contacts
 * and only by leaving the page you were on.
 */
export default function CommandPalette() {
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = useTranslation('common');
  const { t: tNav } = useTranslation('sidebar');
  const { toggle } = useTheme();
  const { language, setLanguage } = useLanguage();
  const { isOperator } = useOperatorAccess();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global shortcut + programmatic open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Remote search, debounced. Stale responses are dropped by the `live` flag.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const data = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
        if (live) setResults(data ?? null);
      } catch {
        if (live) setResults(null);
      } finally {
        if (live) setSearching(false);
      }
    }, 180);
    return () => { live = false; clearTimeout(id); };
  }, [query]);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const role = (session?.user as { role?: string } | undefined)?.role;
  const staticEntries = useMemo<Entry[]>(() => {
    const nav: Entry[] = visibleGroups({ manager: isManager(role), operator: isOperator })
      .flatMap((g) => g.items)
      .concat(SETTINGS_ITEM)
      .map((item) => ({
        id: `nav:${item.key}`,
        group: t('palette.jump'),
        label: tNav(`nav.${item.key}`),
        icon: item.icon,
        keywords: item.href,
        run: () => go(item.href),
      }));
    const actions: Entry[] = [
      { id: 'act:broadcast', group: t('palette.actions'), label: t('palette.newBroadcast'), icon: Send, run: () => go('/broadcasts/new') },
      { id: 'act:contact', group: t('palette.actions'), label: t('palette.addContact'), icon: UserPlus, run: () => go('/contacts?new=1') },
      { id: 'act:import', group: t('palette.actions'), label: t('palette.importContacts'), icon: Upload, run: () => go('/contacts?import=1') },
      { id: 'act:ai', group: t('palette.actions'), label: t('palette.askAi'), icon: Sparkles, run: () => { setOpen(false); document.dispatchEvent(new CustomEvent('toggle-crm-assistant')); } },
      { id: 'act:template', group: t('palette.actions'), label: t('palette.newTemplate'), icon: FileText, run: () => go('/templates/builder') },
      { id: 'act:theme', group: t('palette.preferences'), label: t('palette.toggleTheme'), icon: Moon, run: () => { toggle(); setOpen(false); } },
      { id: 'act:lang', group: t('palette.preferences'), label: language === 'en' ? 'التبديل إلى العربية' : 'Switch to English', icon: Globe, run: () => { setLanguage(language === 'en' ? 'ar' : 'en'); setOpen(false); } },
    ];
    return [...actions.slice(0, 5), ...nav, ...actions.slice(5)];
  }, [role, isOperator, t, tNav, go, toggle, language, setLanguage]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const local = q
      ? staticEntries.filter((e) => `${e.label} ${e.keywords ?? ''}`.toLowerCase().includes(q))
      : staticEntries;
    const remote: Entry[] = [];
    const add = (hits: SearchHit[] | undefined, group: string, icon: LucideIcon) =>
      hits?.forEach((h) => remote.push({ id: `${group}:${h.id}`, group, label: h.title, sub: h.subtitle, icon, run: () => go(h.href) }));
    add(results?.contacts, t('palette.contacts'), User);
    add(results?.conversations, t('palette.conversations'), MessageSquare);
    add(results?.templates, t('palette.templates'), LayoutTemplate);
    add(results?.broadcasts, t('palette.broadcasts'), Megaphone);
    // When searching, records come first: that is almost always what was typed for.
    return q ? [...remote, ...local] : local;
  }, [query, staticEntries, results, go, t]);

  useEffect(() => { setCursor(0); }, [query, results]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, entries.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); entries[cursor]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  if (!mounted) return null;

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center px-3 pt-[12vh] sm:pt-[14vh]" onKeyDown={onKeyDown}>
          <motion.div
            className="absolute inset-0 bg-[rgb(8_12_10/0.45)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('palette.placeholder')}
            className="relative flex max-h-[min(560px,72vh)] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl bg-surface shadow-pop"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              {searching
                ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-ink-4" aria-hidden="true" />
                : <Search className="h-[18px] w-[18px] shrink-0 text-ink-4" aria-hidden="true" />}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('palette.placeholder')}
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
                aria-controls="nx-palette-list"
                aria-activedescendant={entries[cursor] ? `nx-pal-${cursor}` : undefined}
              />
              <span className="kbd hidden sm:inline-flex">esc</span>
            </div>

            <div ref={listRef} id="nx-palette-list" role="listbox" className="flex-1 overflow-y-auto p-2">
              {entries.length === 0 && !searching && (
                <p className="px-3 py-10 text-center text-[13px] text-ink-3">{t('palette.empty', { query })}</p>
              )}
              {entries.map((e, i) => {
                const header = e.group !== lastGroup ? e.group : null;
                lastGroup = e.group;
                const Icon = e.icon;
                const active = i === cursor;
                return (
                  <div key={e.id}>
                    {header && <p className="eyebrow px-3 pb-1.5 pt-3 first:pt-1">{header}</p>}
                    <button
                      type="button"
                      id={`nx-pal-${i}`}
                      role="option"
                      aria-selected={active}
                      data-index={i}
                      onMouseMove={() => setCursor(i)}
                      onClick={() => e.run()}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors duration-fast',
                        active ? 'bg-raised' : 'hover:bg-raised/60',
                      )}
                    >
                      <span className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors',
                        active ? 'border-brand/30 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-3',
                      )}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink"><bdi>{e.label}</bdi></span>
                        {e.sub && <span className="block truncate text-2xs text-ink-3"><bdi>{e.sub}</bdi></span>}
                      </span>
                      {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-2xs text-ink-3 sm:flex">
              <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span>{t('palette.navigate')}</span>
              <span className="flex items-center gap-1.5"><span className="kbd">↵</span>{t('palette.open')}</span>
              <span className="ms-auto flex items-center gap-1.5"><span className="kbd">⌘</span><span className="kbd">K</span>{t('palette.toggle')}</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
