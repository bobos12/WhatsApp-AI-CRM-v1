'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Plus, Upload, Search, Users2, Filter, X, BriefcaseBusiness,
  CheckSquare, MessageSquare, PlusCircle, SlidersHorizontal,
  Trash2, CalendarRange, UserCheck, Tag as TagIcon, StickyNote, Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ContactsTable, { type ContactSortKey } from '../../../components/contacts/ContactsTable';
import ContactForm from '../../../components/contacts/ContactForm';
import ContactTimeline from '../../../components/contacts/ContactTimeline';
import ContactTagSelector from '../../../components/contacts/ContactTagSelector';
import ImportWizard from '../../../components/contacts/import/ImportWizard';
import { TablePagination } from '../../../components/ui/TablePagination';
import { api } from '../../../lib/api';
import { useSession } from 'next-auth/react';
import { useSocket } from '../../../hooks/useSocket';
import { useTags } from '../../../hooks/useTags';
import { useCustomFields } from '../../../hooks/useCustomFields';
import { formatFieldValue, type CustomFieldValues } from '../../../lib/custom-fields';
import AudienceFilterBuilder from '../../../components/contacts/AudienceFilterBuilder';
import {
  activeConditionCount,
  filterQueryParam,
  filterableFields,
  EMPTY_FILTER,
  type AudienceFilter,
} from '../../../lib/audience-filter';
import { Modal } from '../../../components/ui/modal';
import { cn } from '../../../lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { PageHeader, SearchField } from '../../../components/ui/page';

interface ContactTagRef {
  tag: { id: string; name: string; color: string };
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email?: string | null;
  company?: string | null;
  notes: string | null;
  createdAt: string;
  contactTags?: ContactTagRef[];
  /** Holds both user-defined field values and the reserved `avatarUrl` cache. */
  customFields?: (CustomFieldValues & { avatarUrl?: string | null }) | null;
}

/** A contact is "saved" when it carries a real name — vs. an unknown WhatsApp number. */
const isSavedContact = (c: Contact) => !!(c.name && c.name.trim());

type ContactSegment = 'all' | 'saved' | 'unsaved';

/** A pill-style on/off filter toggle used in the advanced filter panel. */
function FilterToggle({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors',
        active
          ? 'border-brand/40 bg-brand/10 text-brand'
          : 'border-line bg-white dark:bg-raised text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/10',
      )}
    >
      {active ? <Check className="h-3.5 w-3.5" /> : icon}
      {label}
    </button>
  );
}

interface ContactDetails {
  contact: Contact;
  deals: Array<{ id: string; title: string; stage: string; value: number }>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  conversations: Array<{ id: string; status: string; lastMessage: string | null; lastMessageAt: string | null }>;
}

export default function ContactsPage() {
  const { status } = useSession();
  const { t } = useTranslation('contacts');
  const { t: tc } = useTranslation('common');
  const searchParams = useSearchParams();

  // — data —
  const [contacts, setContacts] = useState<Contact[]>([]);
  const allTags = useTags();   // live tag list — auto-updates via socket

  // — search & server-side filters —
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [tagFilter, setTagFilter] = useState('');   // tag name string

  // — saved/unsaved segment (primary quick filter) —
  const [segment, setSegment] = useState<ContactSegment>('all');

  // — advanced client-side filters —
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasTags, setHasTags] = useState(false);
  const [hasNotes, setHasNotes] = useState(false);

  // — condition filters (notes, company, any custom field) — evaluated server-side —
  const [advancedFilter, setAdvancedFilter] = useState<AudienceFilter>(EMPTY_FILTER);

  // — sort —
  const [sortKey, setSortKey] = useState<ContactSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // — pagination —
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // — selection —
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // — row-level confirm delete —
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // — UI state —
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [details, setDetails] = useState<ContactDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'timeline' | 'tags'>('overview');
  const [showImport, setShowImport] = useState(false);

  // Deep links from ⌘K and the dashboard: /contacts?new=1, /contacts?import=1.
  useEffect(() => {
    if (searchParams.get('new') === '1') setShowForm(true);
    if (searchParams.get('import') === '1') setShowImport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Custom-field definitions drive the extra rows in the detail drawer *and* the
  // set of fields the condition builder can filter on.
  const { definitions: customFieldDefs } = useCustomFields();

  // ─── Data fetching ────────────────────────────────────────────────────────

  // A serialized filter, or null while none is set. Held as a string so the fetch
  // below re-runs on a *changed* filter rather than on every render of an
  // equivalent object.
  const filterQuery = useMemo(
    () => filterQueryParam(advancedFilter, filterableFields(customFieldDefs)),
    [advancedFilter, customFieldDefs],
  );

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (tagFilter) params.append('tag', tagFilter);
      // Conditions are evaluated by the server — the same evaluator the broadcast
      // audience uses, so both surfaces agree on who matches.
      if (filterQuery) params.append('filter', filterQuery);
      const data = await api.get(`/api/contacts?${params}`);
      setContacts(Array.isArray(data) ? data : []);
      setPage(1);
    } catch {
      setContacts([]);
    }
  }, [search, tagFilter, filterQuery]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchContacts();
  }, [fetchContacts, status]);

  const onMessageNew = useCallback(
    (data: any) => {
      if (status === 'authenticated' && data?.isNewContact) fetchContacts();
    },
    [status, fetchContacts],
  );
  useSocket('message:new', onMessageNew);

  // ─── Derived / processed data ─────────────────────────────────────────────

  // Counts per segment — drawn from the full fetched list so the tabs stay stable.
  const segmentCounts = useMemo(() => {
    let saved = 0;
    for (const c of contacts) if (isSavedContact(c)) saved++;
    return { all: contacts.length, saved, unsaved: contacts.length - saved };
  }, [contacts]);

  const processedContacts = useMemo(() => {
    let data = [...contacts];
    if (segment === 'saved') data = data.filter(isSavedContact);
    else if (segment === 'unsaved') data = data.filter((c) => !isSavedContact(c));
    if (hasTags) data = data.filter((c) => (c.contactTags?.length ?? 0) > 0);
    if (hasNotes) data = data.filter((c) => !!(c.notes && c.notes.trim()));
    if (dateFrom) data = data.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
    if (dateTo) data = data.filter((c) => new Date(c.createdAt) <= new Date(dateTo + 'T23:59:59'));
    if (sortKey) {
      data.sort((a, b) => {
        const av = String(a[sortKey] ?? '');
        const bv = String(b[sortKey] ?? '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return data;
  }, [contacts, segment, hasTags, hasNotes, dateFrom, dateTo, sortKey, sortDir]);

  const totalCount = processedContacts.length;

  const paginatedContacts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return processedContacts.slice(start, start + pageSize);
  }, [processedContacts, page, pageSize]);

  // ─── Sort ─────────────────────────────────────────────────────────────────

  const handleSort = (key: ContactSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  // ─── Selection ────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const pageIds = paginatedContacts.map((c) => c.id);
    const allSel = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  const handleSave = async (contact: Partial<Contact> & { tagIds?: string[] }) => {
    if (editingContact) {
      const { tagIds: _ignored, ...contactData } = contact;
      // Tags are handled live by ContactTagSelector in the form — nothing to do here
      await api.put(`/api/contacts/${editingContact.id}`, contactData);
    } else {
      // The create endpoint attaches tags in the same request, so a failure there
      // can't leave a contact behind with none of its tags.
      await api.post('/api/contacts', contact);
    }
    setShowForm(false);
    setEditingContact(null);
    fetchContacts();
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await api.delete(`/api/contacts/${id}`);
      setConfirmDeleteId(null);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      fetchContacts();
    } catch (err) {
      const s = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
      const message = err instanceof Error ? err.message : 'Failed to delete contact';
      setConfirmDeleteId(null);
      if (s === 409 || message === 'Contact has conversations and cannot be deleted') {
        setError('This contact has conversations and cannot be deleted.');
      } else {
        setError(message);
      }
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let failCount = 0;
    await Promise.allSettled(
      ids.map(async (id) => {
        try { await api.delete(`/api/contacts/${id}`); }
        catch { failCount++; }
      }),
    );
    setSelectedIds(new Set());
    setShowBulkConfirm(false);
    setBulkDeleting(false);
    await fetchContacts();
    if (failCount > 0) {
      setError(`${failCount} contact(s) could not be deleted — they may have active conversations.`);
    }
  };

  const openDetails = async (contact: Contact) => {
    try {
      setSelectedContact(contact);
      setLoadingDetails(true);
      const data = await api.get(`/api/contacts/${contact.id}/details`);
      setDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contact details');
      setSelectedContact(contact);
      setDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (!selectedContact && !showForm) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedContact(null);
        setDetails(null);
        setShowForm(false);
        setEditingContact(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedContact, showForm]);

  // ─── Derived helpers ──────────────────────────────────────────────────────

  const activeFilterCount =
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (hasTags ? 1 : 0) + (hasNotes ? 1 : 0) +
    activeConditionCount(advancedFilter, filterableFields(customFieldDefs));

  const clearAdvancedFilters = () => {
    setDateFrom('');
    setDateTo('');
    setHasTags(false);
    setHasNotes(false);
    setAdvancedFilter(EMPTY_FILTER);
    setPage(1);
  };

  // Tab label lookup
  const TAB_LABELS: Record<'overview' | 'timeline' | 'tags', string> = {
    overview: t('tabs.overview'),
    timeline: t('tabs.timeline'),
    tags: t('tabs.tags'),
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {error}
        </div>
      )}

      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Link href="/settings/custom-fields" className="btn btn-ghost">
              <SlidersHorizontal aria-hidden="true" />
              {t('customFields', { defaultValue: 'Fields' })}
            </Link>
            <button type="button" onClick={() => setShowImport(true)} className="btn btn-secondary">
              <Upload aria-hidden="true" />
              {t('importContacts')}
            </button>
            <button type="button" onClick={() => setShowForm(true)} className="btn btn-primary">
              <Plus aria-hidden="true" />
              {t('addContact')}
            </button>
          </>
        }
      />

      {/* ── Toolbar + table, one surface ── */}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {/* Saved / unsaved — the quick filter people reach for first */}
          <div className="seg max-w-full overflow-x-auto scrollbar-none">
            {([
              { key: 'all', label: t('segments.all'), count: segmentCounts.all },
              { key: 'saved', label: t('segments.saved'), count: segmentCounts.saved },
              { key: 'unsaved', label: t('segments.unsaved'), count: segmentCounts.unsaved },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                data-active={segment === key}
                onClick={() => { setSegment(key); setPage(1); }}
                title={key === 'saved' ? t('segments.savedHint') : key === 'unsaved' ? t('segments.unsavedHint') : undefined}
                className="seg-item"
              >
                {label}
                <span className="tabular-nums text-ink-4">{count}</span>
              </button>
            ))}
          </div>
          <SearchField value={search} onChange={setSearch} placeholder={t('searchPlaceholder')} className="min-w-[200px] flex-1" />
          <button
            type="button"
            onClick={() => setShowFilters((f) => !f)}
            aria-expanded={showFilters}
            className={cn('btn btn-secondary', (showFilters || activeFilterCount > 0) && 'border-brand/40 text-brand')}
          >
            <SlidersHorizontal aria-hidden="true" />
            {tc('actions.filter')}
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Tag chips */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-2 scrollbar-none">
            <span className="me-1 inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-ink-3">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              {tc('labels.tags')}
            </span>
            <button
              type="button"
              onClick={() => setTagFilter('')}
              className={cn('h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-colors', !tagFilter ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-raised')}
            >
              {tc('all')}
            </button>
            {allTags.map((tag) => {
              const active = tagFilter === tag.name;
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setTagFilter(active ? '' : tag.name)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                    active ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                  {tag.name}
                  {tag._count !== undefined && <span className={cn('tabular-nums', active ? 'text-surface/70' : 'text-ink-4')}>{tag._count.contacts}</span>}
                  {active && <X className="h-3 w-3 opacity-70" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Advanced filter panel */}
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-b border-line bg-raised/40"
            >
              <div className="px-4 py-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="label flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> {t('createdFrom')}</label>
                    <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="field w-auto" />
                  </div>
                  <div>
                    <label className="label">{t('createdTo')}</label>
                    <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="field w-auto" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FilterToggle active={hasTags} onClick={() => { setHasTags((v) => !v); setPage(1); }} icon={<TagIcon className="h-3.5 w-3.5" />} label={t('filters.hasTags')} />
                    <FilterToggle active={hasNotes} onClick={() => { setHasNotes((v) => !v); setPage(1); }} icon={<StickyNote className="h-3.5 w-3.5" />} label={t('filters.hasNotes')} />
                  </div>
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={clearAdvancedFilters} className="btn btn-ghost">
                      <X aria-hidden="true" />
                      {t('clearFilters')}
                    </button>
                  )}
                </div>
                {/* Field conditions — notes, company, status, and every custom field
                    the business has defined. Same builder the broadcast audience uses. */}
                <div className="mt-4">
                  <AudienceFilterBuilder value={advancedFilter} onChange={setAdvancedFilter} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results info row */}
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-xs text-ink-3">
            <span className="tabular-nums">{t('totalContacts', { count: totalCount })}</span>
            {selectedIds.size > 0 && (
              <span className="ms-2 font-medium text-brand">· {t('bulkActions.selected', { count: selectedIds.size })}</span>
            )}
          </p>
          {selectedIds.size > 0 && (
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-ink-3 transition-colors hover:text-ink">
              {t('clearSelection')}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="px-0">
          <ContactsTable
            contacts={paginatedContacts}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onEdit={(contact) => { setEditingContact(contact); setShowForm(true); }}
            onOpenDetails={openDetails}
            onDelete={handleDelete}
            confirmDeleteId={confirmDeleteId}
            onConfirmDelete={setConfirmDeleteId}
            customFieldDefs={customFieldDefs}
          />

          {/* Empty state */}
          {totalCount === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-raised">
                <Users2 className="h-6 w-6 text-ink-4" />
              </div>
              {contacts.length === 0 ? (
                <>
                  <p className="text-sm font-medium text-ink">{t('noContacts')}</p>
                  <p className="text-xs text-ink-3">{t('noContactsSubtitle')}</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">{t('emptyFiltered')}</p>
                  <p className="text-xs text-ink-3">{t('emptyFilteredSubtitle')}</p>
                  <button
                    type="button"
                    onClick={() => { setSegment('all'); setTagFilter(''); clearAdvancedFilters(); setSearch(''); }}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-3 hover:bg-raised transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('clearFilters')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={totalCount}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-[var(--bottom-nav-space)] sm:bottom-6 left-1/2 z-40 -translate-x-1/2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <span className="text-sm font-medium text-white">
            {t('bulkActions.selected', { count: selectedIds.size })}
          </span>
          <div className="h-5 w-px bg-white/15" />
          {showBulkConfirm ? (
            <>
              <span className="text-xs text-red-300">{t('deleteBulk', { count: selectedIds.size })}</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? '…' : t('yesDelete')}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-ink-3 hover:bg-white/10 transition-colors"
              >
                {tc('actions.cancel')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('bulkActions.delete')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-ink-3 hover:bg-white/10 transition-colors"
              >
                {tc('actions.deselectAll')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />

      {/* ── Create / Edit modal (ContactForm renders its own accessible Modal) ── */}
      {showForm && (
        <ContactForm
          contact={editingContact}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingContact(null);
          }}
        />
      )}

      {showImport && (
        <ImportWizard onClose={() => setShowImport(false)} onImported={fetchContacts} />
      )}

      {/* ── Contact detail drawer ── */}
      {selectedContact && (
        <Modal
          open
          onClose={() => { setSelectedContact(null); setDetails(null); }}
          aria-label={t('contactDetails')}
          overlayClassName="items-stretch justify-end p-0 bg-black/60"
          className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-canvas p-6 shadow-pop"
        >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-brand/70">{t('contactDetails')}</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {selectedContact.name
                    ? <bdi>{selectedContact.name}</bdi>
                    : <span dir="ltr">{'‎'}{selectedContact.phone}</span>}
                </h2>
                <p className="mt-1 text-sm text-ink-3" dir="ltr">{'‎'}{selectedContact.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedContact(null); setDetails(null); }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              >
                {tc('actions.close')}
              </button>
            </div>

            <div className="mt-4 flex gap-1 border-b border-white/10">
              {(['overview', 'timeline', 'tags'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={cn(
                    'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    detailTab === tab
                      ? 'border-brand text-brand'
                      : 'border-transparent text-ink-3 hover:text-white',
                  )}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>

            {detailTab === 'tags' && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-semibold text-white">{tc('labels.tags')}</p>
                <ContactTagSelector contactId={selectedContact.id} />
              </div>
            )}

            {detailTab === 'timeline' && (
              <div className="mt-6">
                <ContactTimeline contactId={selectedContact.id} />
              </div>
            )}

            {detailTab === 'overview' && (
              loadingDetails ? (
                <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-ink-3">
                  {t('loadingDetails')}
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  {/* Built-in profile fields plus every custom field the business defined. */}
                  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <UserCheck className="h-4 w-4 text-brand" />
                      {t('profileSection', { defaultValue: 'Profile' })}
                    </div>
                    <dl className="space-y-2.5">
                      {[
                        { label: t('form.email', { defaultValue: 'Email' }), value: details?.contact.email },
                        { label: t('form.company', { defaultValue: 'Company' }), value: details?.contact.company },
                        { label: t('form.notes'), value: details?.contact.notes },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-start justify-between gap-4">
                          <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
                          <dd className="min-w-0 break-words text-end text-sm text-white">{value || '—'}</dd>
                        </div>
                      ))}

                      {customFieldDefs.map((definition) => (
                        <div key={definition.id} className="flex items-start justify-between gap-4">
                          <dt className="shrink-0 text-xs text-ink-3">{definition.label}</dt>
                          <dd className="min-w-0 break-words text-end text-sm text-white">
                            {formatFieldValue(definition, details?.contact.customFields?.[definition.key])}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {customFieldDefs.length === 0 && (
                      <Link
                        href="/settings/custom-fields"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
                      >
                        <SlidersHorizontal className="h-3 w-3" />
                        {t('addCustomFields', { defaultValue: 'Add custom fields' })}
                      </Link>
                    )}
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <BriefcaseBusiness className="h-4 w-4 text-orange-400" />
                      {t('dealsSection')}
                    </div>
                    <div className="mb-3">
                      <Link
                        href={`/deals?contactId=${encodeURIComponent(selectedContact.id)}`}
                        className="btn btn-primary btn-sm inline-flex"
                      >
                        <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                        {t('newDeal')}
                      </Link>
                    </div>
                    <div className="space-y-2">
                      {(details?.deals || []).map((deal) => (
                        <div key={deal.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <p className="font-medium text-white">{deal.title}</p>
                          <p className="text-sm text-ink-3">{deal.stage} · ${Number(deal.value || 0).toLocaleString()}</p>
                        </div>
                      ))}
                      {!details?.deals?.length && <p className="text-sm text-ink-3">{t('noDeals')}</p>}
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <CheckSquare className="h-4 w-4 text-brand" />
                      {t('tasksSection')}
                    </div>
                    <div className="mb-3">
                      <Link
                        href={`/tasks?contactId=${encodeURIComponent(selectedContact.id)}`}
                        className="inline-flex items-center rounded-full bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      >
                        <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                        {t('newTask')}
                      </Link>
                    </div>
                    <div className="space-y-2">
                      {(details?.tasks || []).map((task) => (
                        <div key={task.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                          <p className="font-medium text-white">{task.title}</p>
                          <p className="text-sm text-slate-400">
                            {task.status}{task.dueDate ? ` · ${new Date(task.dueDate).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                      ))}
                      {!details?.tasks?.length && <p className="text-sm text-slate-400">{t('noTasks')}</p>}
                    </div>
                  </section>

                  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <MessageSquare className="h-4 w-4 text-emerald-300" />
                      {t('conversationsSection')}
                    </div>
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => { window.location.href = `/conversations?phone=${encodeURIComponent(selectedContact.phone)}`; }}
                        className="inline-flex items-center rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      >
                        {t('openConversation')}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {(details?.conversations || []).map((conversation) => (
                        <div key={conversation.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                          <p className="font-medium text-white">{conversation.status}</p>
                          <p className="text-sm text-slate-400">{conversation.lastMessage || 'No last message'}</p>
                        </div>
                      ))}
                      {!details?.conversations?.length && <p className="text-sm text-slate-400">{t('noLinkedConversations')}</p>}
                    </div>
                  </section>
                </div>
              )
            )}
        </Modal>
      )}
    </div>
  );
}
