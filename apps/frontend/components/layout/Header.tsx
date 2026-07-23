'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LogOut, Sun, Moon, RefreshCw, Search, Mail, ChevronDown, Globe, Check, Bot,
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useLanguage } from '@/components/providers/I18nProvider';
import { useChatOpen } from '@/stores/chat-open-store';
import { useHeaderHidden } from '@/stores/header-hidden-store';
import { cn } from '@/lib/utils';
import { hardRefresh } from '@/lib/hard-refresh';
import { haptic } from '@/lib/haptics';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import NotificationBell from '@/components/notifications/NotificationBell';
import { toSimpleRole, SIMPLE_ROLE_LABEL, SIMPLE_ROLE_BADGE } from '@/lib/roles';
import { useChatUnread } from '@/stores/chat-unread-store';
import { api } from '@/lib/api';

const ICON_BTN =
  'press-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 ' +
  'hover:bg-gray-100 hover:text-gray-900 ' +
  'dark:text-[#8696A0] dark:hover:bg-[#2A3942] dark:hover:text-[#E9EDEF] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40';

export default function Header() {
  const router = useRouter();
  const { data: session } = useSession();
  const { theme, toggle } = useTheme();
  const { language, setLanguage } = useLanguage();
  const chatWindowOpen = useChatOpen((s) => s.isOpen);
  const headerHidden = useHeaderHidden((s) => s.hidden);
  const { t } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const { connection, syncing, lastSynced, sync } = useSyncStatus();
  const chatUnread = useChatUnread((s) => s.total);
  const resetChatUnread = useChatUnread((s) => s.reset);

  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hardRefreshing, setHardRefreshing] = useState(false);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  // Attached to the search <form>, not a div — it is only read for `.contains()`
  // in the click-outside handler, but the element type still has to match.
  const searchDropdownRef = useRef<HTMLFormElement>(null);

  const onHardRefresh = () => {
    if (hardRefreshing) return;
    setHardRefreshing(true);
    haptic('medium');
    void hardRefresh();
  };

  const user     = session?.user as any;
  const name     = user?.name  || user?.email || '?';
  const email    = user?.email || '';
  const role     = user?.role  || '';
  const initials = name.charAt(0).toUpperCase();

  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the account menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // Close the mobile account menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [mobileMenuOpen]);

  // Close search dropdown on outside click
  useEffect(() => {
    if (!searchResults) return;
    const onClick = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setSearchResults(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [searchResults]);

  const handleSearchChange = useCallback(async (value: string) => {
    setQuery(value);
    if (value.length < 2) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const results = await api.get(`/api/search?q=${encodeURIComponent(value)}`);
      setSearchResults(results);
    } catch {
      setSearchResults(null);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/contacts?search=${encodeURIComponent(q)}`);
    setSearchResults(null);
  };

  const navigateToResult = (href: string) => {
    router.push(href);
    setSearchResults(null);
    setQuery('');
  };

  const syncTitle = lastSynced
    ? tCommon('header.lastSynced', { time: lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : tCommon('header.syncNow');

  return (
    <header className={`sticky top-0 z-40 bg-white/90 backdrop-blur-md dark:bg-[#0B141A]/90 border-b border-gray-100/60 dark:border-white/5${headerHidden ? ' hidden' : chatWindowOpen ? ' hidden sm:block' : ''}`}>

      {/* ── Mobile header (hidden sm+) ── */}
      <div className="flex sm:hidden items-center justify-between px-4 py-3">
        {/* Left: account dropdown */}
        <div className="relative min-w-0" ref={mobileMenuRef}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={mobileMenuOpen}
            className="flex max-w-[62vw] items-center gap-2 rounded-full py-1 pe-1.5 ps-1 transition-colors hover:bg-gray-100 dark:hover:bg-[#2A3942] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1f9255] to-[#0c3a27] text-sm font-bold text-white shadow-sm" aria-hidden="true">
              {initials}
            </span>
            <span className="min-w-0 leading-tight text-start">
              <span className="block truncate text-[13px] font-bold text-gray-900 dark:text-white">{name}</span>
              {role && (
                <span className={cn('block text-[10px] font-semibold uppercase tracking-wide', toSimpleRole(role) === 'SYSTEM_MANAGER' ? 'text-amber-500' : 'text-gray-400 dark:text-[#8696A0]')}>
                  {SIMPLE_ROLE_LABEL[toSimpleRole(role)]}
                </span>
              )}
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', mobileMenuOpen && 'rotate-180')} aria-hidden="true" />
          </button>

          {mobileMenuOpen && (
            <div role="menu" className="absolute start-0 top-[calc(100%+8px)] z-50 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(16,24,40,0.25)] dark:border-white/10 dark:bg-[#111B21]">
              {/* Profile header */}
              <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1f9255] to-[#0c3a27] text-sm font-bold text-white" aria-hidden="true">
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{name}</p>
                  {email && <p className="truncate text-[11px] text-gray-400 dark:text-[#8696A0]">{email}</p>}
                </div>
                {role && (
                  <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SIMPLE_ROLE_BADGE[toSimpleRole(role)])}>
                    {tCommon(`roles.${toSimpleRole(role)}`, { defaultValue: SIMPLE_ROLE_LABEL[toSimpleRole(role)] })}
                  </span>
                )}
              </div>

              <div className="my-1 h-px bg-gray-100 dark:bg-white/8" />

              <button type="button" role="menuitem" onClick={() => { setLanguage(language === 'en' ? 'ar' : 'en'); setMobileMenuOpen(false); }} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                <Globe className="h-4 w-4 text-gray-400" aria-hidden="true" />
                <span className="flex-1 text-start">{language === 'en' ? 'العربية' : 'English'}</span>
              </button>

              <div className="my-1 h-px bg-gray-100 dark:bg-white/8" />

              <button type="button" role="menuitem" onClick={() => signOut()} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1 text-start">{t('logout.button')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: connection dot + bell + AI bot + theme */}
        <div className="flex items-center gap-0.5">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full me-1.5',
              connection === 'connected' ? 'bg-[#25D366] animate-pulse' : connection === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500',
            )}
            aria-hidden="true"
          />
          <NotificationBell />
          <button
            type="button"
            onClick={onHardRefresh}
            disabled={hardRefreshing}
            aria-label={tCommon('header.hardRefresh')}
            title={tCommon('header.hardRefresh')}
            className={cn(ICON_BTN, hardRefreshing && 'cursor-wait text-[#16A34A] dark:text-[#25D366]')}
          >
            <RefreshCw className={cn('h-[18px] w-[18px]', hardRefreshing && 'animate-spin')} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent('toggle-crm-assistant'))}
            aria-label="AI Assistant"
            className={cn(ICON_BTN)}
          >
            <Bot className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={tCommon('header.toggleTheme')}
            className={cn(ICON_BTN)}
          >
            {theme === 'dark'
              ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
              : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* ── Desktop header (hidden on mobile) ── */}
      <div className="hidden sm:flex items-center justify-between gap-3 px-6 py-3.5 lg:px-7">

        {/* Search */}
        <form onSubmit={submitSearch} className="ps-12 lg:ps-0 flex-1 max-w-md relative" ref={searchDropdownRef}>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-[#8696A0]" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={tCommon('header.searchPlaceholder')}
              aria-label={tCommon('header.searchPlaceholder')}
              className={cn(
                'w-full rounded-full border border-transparent bg-[#F1F2F4] py-2.5 ps-11 pe-14 text-sm text-gray-700 transition-colors',
                'placeholder:text-gray-400 focus:border-[#16A34A]/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#16A34A]/15',
                'dark:bg-white/5 dark:text-white dark:placeholder:text-[#8696A0] dark:focus:border-[#25D366]/30 dark:focus:bg-white/[0.07] dark:focus:ring-[#25D366]/15',
              )}
            />
            <kbd aria-hidden="true" className="absolute end-3 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 sm:flex dark:border-white/10 dark:bg-white/5 dark:text-[#8696A0]">
              ⌘K
            </kbd>

            {/* Search Results Dropdown */}
            {searchResults && query.length >= 2 && (
              <div className="absolute top-full start-0 end-0 mt-2 z-50 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] shadow-[0_16px_40px_-12px_rgba(16,24,40,0.25)] dark:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]">
                <div className="max-h-80 overflow-y-auto">
                  {/* Contacts */}
                  {searchResults.contacts?.length > 0 && (
                    <div className="border-b border-gray-100 dark:border-white/10">
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-[#8696A0] uppercase tracking-wider bg-gray-50 dark:bg-white/5">
                        Contacts
                      </div>
                      {searchResults.contacts.map((result: any) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => navigateToResult(result.href)}
                          className="w-full px-4 py-2.5 text-sm text-start text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10">
                            <Search className="h-4 w-4 text-[#25D366]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{result.title}</p>
                            <p className="truncate text-xs text-gray-500 dark:text-[#8696A0]">{result.subtitle}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Templates */}
                  {searchResults.templates?.length > 0 && (
                    <div className="border-b border-gray-100 dark:border-white/10">
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-[#8696A0] uppercase tracking-wider bg-gray-50 dark:bg-white/5">
                        Templates
                      </div>
                      {searchResults.templates.map((result: any) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => navigateToResult(result.href)}
                          className="w-full px-4 py-2.5 text-sm text-start text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
                            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">T</span>
                          </div>
                          <p className="truncate font-medium">{result.title}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Broadcasts */}
                  {searchResults.broadcasts?.length > 0 && (
                    <div className="border-b border-gray-100 dark:border-white/10">
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-[#8696A0] uppercase tracking-wider bg-gray-50 dark:bg-white/5">
                        Broadcasts
                      </div>
                      {searchResults.broadcasts.map((result: any) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => navigateToResult(result.href)}
                          className="w-full px-4 py-2.5 text-sm text-start text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-500/20">
                            <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">B</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{result.title}</p>
                            <p className="truncate text-xs text-gray-500 dark:text-[#8696A0]">{result.subtitle}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Conversations */}
                  {searchResults.conversations?.length > 0 && (
                    <div>
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-[#8696A0] uppercase tracking-wider bg-gray-50 dark:bg-white/5">
                        Conversations
                      </div>
                      {searchResults.conversations.map((result: any) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => navigateToResult(result.href)}
                          className="w-full px-4 py-2.5 text-sm text-start text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center gap-3"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">C</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{result.title}</p>
                            <p className="truncate text-xs text-gray-500 dark:text-[#8696A0]">{result.subtitle}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* No results */}
                  {!searchLoading && !searchResults.contacts?.length && !searchResults.templates?.length && !searchResults.broadcasts?.length && !searchResults.conversations?.length && (
                    <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-[#8696A0]">
                      No results found for "{query}"
                    </div>
                  )}

                  {/* Loading */}
                  {searchLoading && (
                    <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-[#8696A0]">
                      Searching...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Desktop actions */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/conversations"
            onClick={() => resetChatUnread()}
            aria-label={tCommon('header.inbox')}
            title={tCommon('header.inbox')}
            className={cn(ICON_BTN, 'relative', chatUnread > 0 ? 'flex' : 'hidden sm:flex')}
          >
            <Mail className="h-[18px] w-[18px]" aria-hidden="true" />
            {chatUnread > 0 && (
              <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </Link>

          <NotificationBell />

          <div
            className={cn(
              'hidden md:flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold select-none',
              connection === 'connected'
                ? 'border-[#16A34A]/25 bg-[#16A34A]/8 text-[#16A34A] dark:border-[#25D366]/20 dark:bg-[#25D366]/10 dark:text-[#25D366]'
                : connection === 'connecting'
                ? 'border-amber-400/30 bg-amber-400/8 text-amber-600 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-400'
                : 'border-red-400/30 bg-red-400/8 text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-400',
            )}
            aria-live="polite"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                connection === 'connected' ? 'bg-[#16A34A] dark:bg-[#25D366] animate-pulse' : connection === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500',
              )}
              aria-hidden="true"
            />
            {connection === 'connected' ? tCommon('status.connected') : connection === 'connecting' ? tCommon('status.connecting') : tCommon('status.disconnected')}
          </div>

          <button type="button" onClick={sync} disabled={syncing} aria-label={syncTitle} title={syncTitle} className={cn(ICON_BTN, syncing && 'cursor-not-allowed opacity-60')}>
            <RefreshCw className={cn('h-[18px] w-[18px]', syncing && 'animate-spin')} aria-hidden="true" />
          </button>

          <button type="button" onClick={toggle} aria-label={tCommon('header.toggleTheme')} title={tCommon('header.toggleTheme')} className={cn(ICON_BTN)}>
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" /> : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>

          {/* Account */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2.5 rounded-full py-1 pe-2 ps-1 transition-colors hover:bg-gray-100 dark:hover:bg-[#2A3942] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16A34A]/40"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1f9255] to-[#0c3a27] text-sm font-bold text-white" aria-hidden="true">
                {initials}
              </span>
              <span className="hidden min-w-0 text-start leading-tight md:block">
                <span className="block max-w-[150px] truncate text-[13px] font-bold text-gray-900 dark:text-white">{name}</span>
                {email && <span className="block max-w-[150px] truncate text-[11px] text-gray-400 dark:text-[#8696A0]">{email}</span>}
              </span>
              <ChevronDown className={cn('hidden h-4 w-4 shrink-0 text-gray-400 transition-transform md:block', menuOpen && 'rotate-180')} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div role="menu" className="absolute end-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(16,24,40,0.25)] dark:border-white/10 dark:bg-[#111B21]">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{name}</p>
                    {email && <p className="truncate text-[11px] text-gray-400 dark:text-[#8696A0]">{email}</p>}
                  </div>
                  {role && (
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SIMPLE_ROLE_BADGE[toSimpleRole(role)])}>
                      {tCommon(`roles.${toSimpleRole(role)}`, { defaultValue: SIMPLE_ROLE_LABEL[toSimpleRole(role)] })}
                    </span>
                  )}
                </div>
                <div className="my-1 h-px bg-gray-100 dark:bg-white/8" />
                <button type="button" role="menuitem" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                  <Globe className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  <span className="flex-1 text-start">{language === 'en' ? 'العربية' : 'English'}</span>
                </button>
                <button type="button" role="menuitem" onClick={toggle} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                  {theme === 'dark' ? <Sun className="h-4 w-4 text-gray-400" aria-hidden="true" /> : <Moon className="h-4 w-4 text-gray-400" aria-hidden="true" />}
                  <span className="flex-1 text-start">{tCommon('header.toggleTheme')}</span>
                  {theme === 'dark' && <Check className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#25D366]" aria-hidden="true" />}
                </button>
                <button type="button" role="menuitem" onClick={sync} disabled={syncing} title={syncTitle} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:text-white dark:hover:bg-white/5">
                  <RefreshCw className={cn('h-4 w-4 text-gray-400', syncing && 'animate-spin')} aria-hidden="true" />
                  <span className="flex-1 text-start">{syncing ? tCommon('header.syncing') : tCommon('header.sync')}</span>
                  <span className={cn('h-1.5 w-1.5 rounded-full', connection === 'connected' ? 'bg-[#16A34A] dark:bg-[#25D366]' : connection === 'connecting' ? 'bg-amber-400' : 'bg-red-500')} aria-hidden="true" />
                </button>
                <div className="my-1 h-px bg-gray-100 dark:bg-white/8" />
                <button type="button" role="menuitem" onClick={() => signOut()} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1 text-start">{t('logout.button')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
