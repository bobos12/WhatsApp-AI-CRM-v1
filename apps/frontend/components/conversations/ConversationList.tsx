'use client';

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Pin, PinOff, Clock, BellOff, Bookmark, X as XIcon, SlidersHorizontal, ChevronDown, Inbox, SearchX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { formatPhone } from '../../lib/phone';
import { formatListTime, localeFor } from '../../lib/format';
import { useSocket } from '../../hooks/useSocket';
import { useTags } from '../../hooks/useTags';
import { useMessagingStore, type ConversationSummary } from '../../stores/messaging-store';
import Avatar from '../ui/Avatar';
import { SearchField, EmptyState } from '../ui/page';
import { ConversationListSkeleton } from '../ui/Skeleton';

type InboxView = 'all' | 'mine' | 'unassigned';
type Chip = InboxView | 'unread';

const STATUS_OPTIONS = ['', 'OPEN', 'RESOLVED'];

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export interface ConversationListHandle {
  refetch: () => void;
}

/** Click-outside + Escape for a small popover. */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return ref;
}

/**
 * The chat list, shaped like WhatsApp's because that is the list everyone
 * already knows: avatar, name, time, last message, unread count. CRM context
 * (stage, owner, status) sits on a quiet third line only when it exists, and
 * filtering collapses into chips plus one popover — it used to be four stacked
 * rows of pills above the first conversation.
 */
const ConversationList = forwardRef<ConversationListHandle, ConversationListProps>(
  ({ selectedId, onSelect }, ref) => {
    const { t, i18n } = useTranslation(['chat', 'common']);
    const locale = localeFor(i18n.language);
    const { data: session } = useSession();

    const SNOOZE_OPTIONS = [
      { label: t('snooze.30min'), minutes: 30 },
      { label: t('snooze.1hr'), minutes: 60 },
      { label: t('snooze.3hrs'), minutes: 180 },
      { label: t('snooze.tomorrowMorning'), minutes: null, tomorrowMorning: true },
    ];

    const [search, setSearch] = useState('');
    // Skeleton only on a true first load; the shared store already holds the
    // list when the inbox is reopened, so that shows immediately instead.
    const [loading, setLoading] = useState(() => useMessagingStore.getState().conversationOrder.length === 0);
    const [activeView, setActiveView] = useState<InboxView>('all');
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [statusFilter, setStatusFilter] = useState('');
    const [tagFilter, setTagFilter] = useState('');   // tag id, '' = all
    const [rowMenu, setRowMenu] = useState<string | null>(null); // conversationId
    const [filtersOpen, setFiltersOpen] = useState(false);
    const allTags = useTags();

    // ── Zustand store ─────────────────────────────────────────────────────────
    const storeConversations = useMessagingStore(s => s.conversations);
    const storeOrder = useMessagingStore(s => s.conversationOrder);
    const seedConversations = useMessagingStore(s => s.seedConversations);
    const patchConversation = useMessagingStore(s => s.patchConversation);
    const typingStore = useMessagingStore(s => s.typing);
    const typingStart = useMessagingStore(s => s.typingStart);
    const typingStop = useMessagingStore(s => s.typingStop);

    // ── Saved views (localStorage) ────────────────────────────────────────────
    interface SavedView { id: string; name: string; view: InboxView; status: string }
    const [savedViews, setSavedViews] = useState<SavedView[]>([]);
    const [newViewName, setNewViewName] = useState('');

    useEffect(() => {
      try {
        const stored = JSON.parse(localStorage.getItem('inbox_saved_views') || '[]');
        setSavedViews(stored);
      } catch {}
    }, []);

    function persistViews(views: SavedView[]) {
      setSavedViews(views);
      localStorage.setItem('inbox_saved_views', JSON.stringify(views));
    }
    function addSavedView() {
      const name = newViewName.trim();
      if (!name) return;
      persistViews([...savedViews, { id: Date.now().toString(), name, view: activeView, status: statusFilter }]);
      setNewViewName('');
    }
    function removeSavedView(id: string) {
      persistViews(savedViews.filter((v) => v.id !== id));
    }
    function applySavedView(v: SavedView) {
      setActiveView(v.view);
      setStatusFilter(v.status);
      setUnreadOnly(false);
      setFiltersOpen(false);
    }

    // ── Fetch ────────────────────────────────────────────────────────────────
    const fetchConversations = useCallback(async () => {
      try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (statusFilter) params.append('status', statusFilter);
        params.append('view', activeView);
        const data = await api.get(`/api/conversations?${params}`);
        const list = Array.isArray(data) ? data : [];
        seedConversations(list);
      } catch {
        // Keep what's on screen: a dropped request on a weak connection used to
        // wipe the whole inbox.
      } finally {
        setLoading(false);
      }
    }, [search, activeView, statusFilter, seedConversations]);

    useEffect(() => { fetchConversations(); }, [fetchConversations]);
    useImperativeHandle(ref, () => ({ refetch: fetchConversations }), [fetchConversations]);

    // Global event: allow other components to request a refetch (e.g. after sending a message)
    useEffect(() => {
      const handler = () => { fetchConversations(); };
      window.addEventListener('conversations:refetch', handler);
      return () => window.removeEventListener('conversations:refetch', handler);
    }, [fetchConversations]);

    // Lightweight in-place updates from other components (optimistic sends)
    useEffect(() => {
      const handler = (e: Event) => {
        try {
          const detail = (e as CustomEvent)?.detail;
          const cid = detail?.conversationId;
          const msg = detail?.message;
          if (!cid || !msg) return;
          const existing = useMessagingStore.getState().conversations.get(cid);
          if (!existing) return;
          const isInbound = !msg.fromMe;
          patchConversation(cid, {
            lastMessage: msg.body ?? existing.lastMessage,
            lastMessageAt: msg.timestamp ?? existing.lastMessageAt,
            unreadCount: isInbound ? ((existing.unreadCount ?? 0) + 1) : (existing.unreadCount ?? 0),
          });
        } catch {}
      };
      window.addEventListener('conversation:message', handler as EventListener);
      return () => window.removeEventListener('conversation:message', handler as EventListener);
    }, [patchConversation]);

    // A message for a chat not in the list needs a full reload. A broadcast sends
    // one per recipient, so reloads are capped at one per 5 s — reloading per
    // message was what spent the database's monthly egress.
    const fetchRef = useRef(fetchConversations);
    fetchRef.current = fetchConversations;
    const unknownCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unknownPendingRef = useRef(false);
    useEffect(() => () => { if (unknownCooldownRef.current) clearTimeout(unknownCooldownRef.current); }, []);
    const refetchForUnknown = useCallback(() => {
      // First one reloads at once; any more during the cooldown share one trailing reload.
      if (unknownCooldownRef.current) { unknownPendingRef.current = true; return; }
      void fetchRef.current();
      const cool = () => {
        unknownCooldownRef.current = setTimeout(() => {
          unknownCooldownRef.current = null;
          if (!unknownPendingRef.current) return;
          unknownPendingRef.current = false;
          void fetchRef.current();
          cool();
        }, 5000);
      };
      cool();
    }, []);

    // ── Socket: new message (legacy) → patch store ───────────────────────────
    useSocket('message:new', useCallback((data: any) => {
      const cid = data.conversationId;
      if (!cid) return;
      const existing = useMessagingStore.getState().conversations.get(cid);
      if (!existing) { refetchForUnknown(); return; }
      const isInbound = data.message?.direction === 'INBOUND';
      patchConversation(cid, {
        lastMessage: data.message?.body ?? existing.lastMessage,
        lastMessageAt: data.message?.timestamp ?? existing.lastMessageAt,
        unreadCount: isInbound ? ((existing.unreadCount ?? 0) + 1) : (existing.unreadCount ?? 0),
      });
    }, [refetchForUnknown, patchConversation]));

    // ── Socket: conversation updated (legacy) → patch store ──────────────────
    useSocket('conversation:updated', useCallback((data: any) => {
      const cid = data.conversationId;
      if (!cid) return;
      const patch: Partial<ConversationSummary> = {};
      if (data.status !== undefined) patch.status = data.status;
      if (data.assignedTo !== undefined) patch.assignedTo = data.assignedTo;
      if (data.assignedTeamId !== undefined) patch.assignedTeamId = data.assignedTeamId;
      if (data.pipeline !== undefined) patch.pipeline = data.pipeline;
      if (data.unreadCount !== undefined) patch.unreadCount = data.unreadCount;
      if (data.lastMessagePreview !== undefined) patch.lastMessage = data.lastMessagePreview;
      if (data.lastMessage !== undefined) patch.lastMessage = data.lastMessage;
      if (data.lastMessageAt !== undefined) patch.lastMessageAt = data.lastMessageAt;
      if (data.isPinned !== undefined) patch.isPinned = data.isPinned;
      if (data.snoozedUntil !== undefined) patch.snoozedUntil = data.snoozedUntil;
      patchConversation(cid, patch);
    }, [patchConversation]));

    // ── Socket: typing indicators → store ───────────────────────────────────
    useSocket('typing:start', useCallback((data: { conversationId: string; userId: string }) => {
      typingStart(data.conversationId, data.userId);
    }, [typingStart]));

    useSocket('typing:stop', useCallback((data: { conversationId: string; userId: string }) => {
      typingStop(data.conversationId, data.userId);
    }, [typingStop]));

    // ── Actions ───────────────────────────────────────────────────────────────
    async function togglePin(conv: ConversationSummary) {
      setRowMenu(null);
      try {
        await api.put(`/api/conversations/${conv.id}/pin`, { isPinned: !conv.isPinned });
        patchConversation(conv.id, { isPinned: !conv.isPinned });
      } catch { /* ignore */ }
    }

    async function snooze(conv: ConversationSummary, option: typeof SNOOZE_OPTIONS[0]) {
      setRowMenu(null);
      let snoozedUntil: string;
      if (option.tomorrowMorning) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        snoozedUntil = d.toISOString();
      } else {
        snoozedUntil = new Date(new Date().getTime() + option.minutes! * 60_000).toISOString();
      }
      try {
        await api.put(`/api/conversations/${conv.id}/snooze`, { snoozedUntil });
        patchConversation(conv.id, { snoozedUntil, status: 'ON_HOLD' });
      } catch { /* ignore */ }
    }

    async function unsnooze(conv: ConversationSummary) {
      setRowMenu(null);
      try {
        await api.put(`/api/conversations/${conv.id}/snooze`, { snoozedUntil: null });
        patchConversation(conv.id, { snoozedUntil: null, status: 'OPEN' });
      } catch { /* ignore */ }
    }

    const currentUserId = (session?.user as { id?: string } | undefined)?.id;

    // Read from store, apply search + tag + unread filters client-side
    const sorted = storeOrder
      .map(id => storeConversations.get(id))
      .filter((c): c is ConversationSummary => {
        if (!c) return false;
        if (search) {
          const name = String((c as any).contact?.name ?? '').toLowerCase();
          const phone = String((c as any).contact?.phone ?? '').toLowerCase();
          const q = search.toLowerCase();
          if (!name.includes(q) && !phone.includes(q)) return false;
        }
        if (tagFilter) {
          const ctags: any[] = (c as any).contact?.contactTags ?? [];
          if (!ctags.some((ct: any) => ct.tag?.id === tagFilter)) return false;
        }
        if (unreadOnly && !((c.unreadCount ?? 0) > 0)) return false;
        return true;
      });

    const activeChip: Chip = unreadOnly ? 'unread' : activeView;
    const chips: { key: Chip; label: string }[] = [
      { key: 'all', label: t('list.all') },
      { key: 'unread', label: t('list.unread') },
      { key: 'mine', label: t('list.mine') },
      { key: 'unassigned', label: t('list.unassigned') },
    ];
    const selectChip = (k: Chip) => {
      if (k === 'unread') { setUnreadOnly(true); setActiveView('all'); }
      else { setUnreadOnly(false); setActiveView(k); }
    };

    const tagName = allTags.find((tg) => tg.id === tagFilter)?.name;
    const filterCount = (statusFilter ? 1 : 0) + (tagFilter ? 1 : 0);
    const closeFilters = useCallback(() => setFiltersOpen(false), []);
    const filtersRef = useDismiss(filtersOpen, closeFilters);
    const closeRowMenu = useCallback(() => setRowMenu(null), []);
    const rowMenuRef = useDismiss(rowMenu !== null, closeRowMenu);
    const totalUnread = sorted.reduce((n, c) => n + ((c.unreadCount ?? 0) > 0 ? 1 : 0), 0);

    const menuItem = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] text-ink-2 hover:bg-raised hover:text-ink';

    return (
      <div className="flex h-full flex-col bg-surface">
        {/* ── Header ── */}
        <div className="box-content flex h-14 shrink-0 items-center justify-between gap-2 px-4 pt-safe">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em] text-ink">
            {t('list.inbox')}
            {totalUnread > 0 && <span className="chip chip-brand tabular-nums">{totalUnread}</span>}
          </h1>
          <div className="relative" ref={filtersRef}>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-label={t('list.filters')}
              title={t('list.filters')}
              className={cn('btn btn-ghost btn-icon btn-sm relative', (filtersOpen || filterCount > 0) && 'bg-raised text-ink')}
            >
              <SlidersHorizontal aria-hidden="true" />
              {filterCount > 0 && <span className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />}
            </button>
            <AnimatePresence>
              {filtersOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute end-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl bg-surface p-3 shadow-pop"
                >
                  <p className="eyebrow mb-2">{t('list.status')}</p>
                  <div className="seg w-full">
                    {STATUS_OPTIONS.map((s) => (
                      <button key={s || 'any'} type="button" data-active={statusFilter === s} onClick={() => setStatusFilter(s)} className="seg-item flex-1">
                        {s ? t(`details.statusOptions.${s}`) : t('list.anyStatus')}
                      </button>
                    ))}
                  </div>

                  {allTags.length > 0 && (
                    <>
                      <p className="eyebrow mb-2 mt-4">{t('list.tags')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map((tag) => {
                          const on = tagFilter === tag.id;
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => setTagFilter(on ? '' : tag.id)}
                              className={cn(
                                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                                on ? 'border-transparent bg-ink text-surface' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                              )}
                            >
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <p className="eyebrow mb-2 mt-4">{t('list.savedViews')}</p>
                  {savedViews.length > 0 && (
                    <ul className="mb-2 space-y-0.5">
                      {savedViews.map((v) => (
                        <li key={v.id} className="group flex items-center gap-1 rounded-md hover:bg-raised">
                          <button type="button" onClick={() => applySavedView(v)} className="flex flex-1 items-center gap-2 px-2 py-1.5 text-start text-[13px] text-ink-2">
                            <Bookmark className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                            <span className="truncate">{v.name}</span>
                          </button>
                          <button type="button" onClick={() => removeSavedView(v.id)} className="me-1 rounded p-1 text-ink-4 opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label="Remove">
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addSavedView(); }}
                      placeholder={t('list.viewName')}
                      className="field field-sm flex-1"
                    />
                    <button type="button" onClick={addSavedView} disabled={!newViewName.trim()} className="btn btn-secondary btn-sm">
                      {t('common:actions.save')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Search + quick chips ── */}
        <div className="shrink-0 space-y-2.5 px-3 pb-2.5">
          <SearchField value={search} onChange={setSearch} placeholder={t('searchPlaceholder')} inputClassName="h-10 rounded-full border-transparent bg-raised hover:border-transparent focus:border-line focus:bg-surface" />
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => selectChip(c.key)}
                className={cn(
                  'h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-fast',
                  activeChip === c.key
                    ? 'border-transparent bg-brand-soft text-brand-strong dark:text-[#D9FDD3]'
                    : 'border-line-strong text-ink-3 hover:bg-raised hover:text-ink',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          {(statusFilter || tagFilter) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {statusFilter && (
                <button type="button" onClick={() => setStatusFilter('')} className="chip chip-neutral h-6 gap-1 px-2">
                  {t(`details.statusOptions.${statusFilter}`)} <XIcon className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              {tagFilter && tagName && (
                <button type="button" onClick={() => setTagFilter('')} className="chip chip-neutral h-6 gap-1 px-2">
                  {tagName} <XIcon className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Rows ── own scroll; reserves the phone tab bar's footprint (0 on sm+). */}
        <div className="flex-1 overflow-y-auto px-2 pb-[var(--bottom-nav-space)]">
          {loading && sorted.length === 0 && <ConversationListSkeleton />}

          {!loading && sorted.length === 0 && (
            search || filterCount || unreadOnly || activeView !== 'all'
              ? <EmptyState compact icon={SearchX} title={t('list.noMatch')} description={t('list.noMatchSub')} />
              : <EmptyState compact icon={Inbox} title={t('noConversations')} description={t('noConversationsSubtitle')} />
          )}

          <ul>
            {sorted.map((conv) => {
              const contact = (conv as any).contact ?? {};
              const displayName = contact.name || formatPhone(contact.phone || '');
              const isAssignedToMe = conv.assignedTo === currentUserId;
              const unread = conv.unreadCount ?? 0;
              const isSnoozed = Boolean(conv.snoozedUntil);
              const isTyping = (typingStore.get(conv.id)?.activeUserIds.size ?? 0) > 0;
              const selected = selectedId === conv.id;
              const assigneeName = (conv as any).assignedUser
                ? (isAssignedToMe ? t('list.mine') : ((conv as any).assignedUser.name || (conv as any).assignedUser.email))
                : null;
              const meta = [
                conv.pipeline ? t(`details.pipeline.${conv.pipeline}`, { defaultValue: conv.pipeline }) : null,
                assigneeName,
              ].filter(Boolean).join(' · ');
              const showUnread = unread > 0 && !selected;

              return (
                <li key={conv.id} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(conv.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(conv.id); } }}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-3 text-start outline-none transition-colors duration-fast focus-visible:bg-raised',
                      selected ? 'bg-raised' : 'hover:bg-raised/70',
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar src={contact.customFields?.avatarUrl} name={displayName} contactId={contact.id} size={48} />
                      {isSnoozed && (
                        <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 ring-2 ring-surface">
                          <BellOff className="h-2.5 w-2.5 text-white" aria-hidden="true" />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-[15px] text-ink', showUnread ? 'font-semibold' : 'font-normal')}>
                          {displayName.startsWith('+') ? <span dir="ltr">{displayName}</span> : <bdi>{displayName}</bdi>}
                        </span>
                        {conv.lastMessageAt && (
                          <span className={cn('shrink-0 text-xs tabular-nums', showUnread ? 'font-medium text-brand' : 'text-ink-3')}>
                            {formatListTime(conv.lastMessageAt, locale, t('window.yesterday'))}
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 flex items-center gap-2">
                        {isTyping ? (
                          <span className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium text-brand">
                            {t('window.typing')}
                            <span className="inline-flex gap-0.5" aria-hidden="true">
                              <span className="h-1 w-1 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-brand [animation-delay:150ms]" />
                              <span className="h-1 w-1 animate-bounce rounded-full bg-brand [animation-delay:300ms]" />
                            </span>
                          </span>
                        ) : (
                          <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', showUnread ? 'text-ink-2' : 'text-ink-3')}>
                            <bdi>{(conv.lastMessagePreview ?? conv.lastMessage) || t('window.noMessages')}</bdi>
                          </span>
                        )}
                        <span className="flex shrink-0 items-center gap-1">
                          {conv.isPinned && <Pin className="h-3.5 w-3.5 rotate-45 text-ink-4" aria-hidden="true" />}
                          {showUnread && (
                            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-brand-fg">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                          {/* Row menu trigger — slides in on hover, like WhatsApp Web; always present on touch. */}
                          <button
                            type="button"
                            aria-label={t('list.chatOptions')}
                            onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === conv.id ? null : conv.id); }}
                            className={cn(
                              'flex h-5 w-5 items-center justify-center overflow-hidden rounded text-ink-3 transition-all duration-fast hover:text-ink',
                              '[@media(hover:hover)]:w-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:w-5 [@media(hover:hover)]:group-hover:opacity-100',
                              rowMenu === conv.id && '!w-5 !opacity-100',
                            )}
                          >
                            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                          </button>
                        </span>
                      </div>

                      {(meta || conv.status !== 'OPEN' || isSnoozed) && (
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-4">
                          {conv.status !== 'OPEN' && !isSnoozed && (
                            <span className={cn('chip h-[18px]', conv.status === 'PENDING' ? 'chip-warn' : 'chip-neutral')}>
                              {t(`details.statusOptions.${conv.status}`, { defaultValue: conv.status })}
                            </span>
                          )}
                          {isSnoozed && (
                            <span className="text-amber-700 dark:text-amber-400">
                              {t('list.snoozedUntil', { time: new Date(conv.snoozedUntil!).toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })}
                            </span>
                          )}
                          {meta && <span className="truncate">{meta}</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {rowMenu === conv.id && (
                    <div ref={rowMenuRef} className="pop-enter absolute end-3 top-12 z-30 w-48 rounded-lg bg-surface p-1 shadow-pop">
                      <button type="button" onClick={() => togglePin(conv)} className={menuItem}>
                        {conv.isPinned ? <PinOff className="h-4 w-4 text-ink-3" /> : <Pin className="h-4 w-4 text-ink-3" />}
                        {conv.isPinned ? t('list.unpin') : t('list.pin')}
                      </button>
                      <div className="my-1 h-px bg-line" />
                      {isSnoozed ? (
                        <button type="button" onClick={() => unsnooze(conv)} className={menuItem}>
                          <BellOff className="h-4 w-4 text-ink-3" />
                          {t('list.unsnooze')}
                        </button>
                      ) : (
                        <>
                          <p className="px-2.5 pb-1 pt-1.5 text-2xs font-medium text-ink-4">{t('list.snoozeFor')}</p>
                          {SNOOZE_OPTIONS.map((opt) => (
                            <button key={opt.label} type="button" onClick={() => snooze(conv, opt)} className={cn(menuItem, 'py-1.5')}>
                              <Clock className="h-3.5 w-3.5 text-ink-4" />
                              {opt.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  },
);

ConversationList.displayName = 'ConversationList';
export default ConversationList;
