'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { PageHeader } from '@/components/ui/page';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  UserCog, Plus, Pencil, Trash2, ShieldCheck, Search,
  SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, X, Check,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { TablePagination } from '../../../../components/ui/TablePagination';
import { Modal } from '../../../../components/ui/modal';
import { cn } from '../../../../lib/utils';
import { useToast } from '../../../../hooks/useToast';
import {
  type SimpleRole,
  SIMPLE_ROLES,
  SIMPLE_ROLE_LABEL,
  SIMPLE_ROLE_BADGE,
  toSimpleRole,
  simpleRoleToStored,
  isManager,
} from '../../../../lib/roles';
import { useRemembered } from '@/hooks/useRemembered';
import { useLiveData } from '../../../../hooks/useLiveData';

type UserSortKey = 'name' | 'email' | 'role' | 'createdAt';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  createdAt: string;
  team?: { id: string; name: string } | null;
};

type Team = { id: string; name: string };

const ROLE_ORDER: Record<SimpleRole, number> = {
  SYSTEM_MANAGER: 2,
  EMPLOYEE: 1,
};

const emptyForm = { name: '', email: '', password: '', role: 'EMPLOYEE' as SimpleRole, teamId: '' };

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-brand" />
    : <ArrowDown className="h-3 w-3 text-brand" />;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const { t } = useTranslation('admin');
  const role = (session?.user as any)?.role;

  // ─── data ─────────────────────────────────────────────────────────────────
  const [users, setUsers, firstUsers]   = useRemembered<User[]>('admin:users', []);
  const [teams, setTeams]   = useRemembered<Team[]>('admin:teams', []);
  const [loading, setLoading] = useState(firstUsers);

  // ─── form ─────────────────────────────────────────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<User | null>(null);
  const [formData, setFormData]   = useState(emptyForm);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  // ─── search ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ─── advanced filters ─────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [filterRole, setFilterRole]   = useState('');
  const [filterTeam, setFilterTeam]   = useState('');

  // ─── sort ─────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<UserSortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ─── pagination ───────────────────────────────────────────────────────────
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ─── selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting]       = useState(false);

  // ─── row confirm delete ───────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ─── Guard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (status === 'loading') return;
    if (!isManager(role)) router.replace('/dashboard');
  }, [role, status, router]);

  // ─── Load ─────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [usersData, teamsData] = await Promise.all([
        api.get('/api/users'),
        api.get('/api/teams/all'),
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (editing) {
      setFormData({ name: editing.name, email: editing.email, password: '', role: toSimpleRole(editing.role), teamId: editing.teamId || '' });
    } else {
      setFormData(emptyForm);
    }
  }, [editing, showForm]);
  useLiveData(['users', 'teams'], loadData);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const processedUsers = useMemo(() => {
    let data = [...users];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    if (filterRole) data = data.filter((u) => toSimpleRole(u.role) === filterRole);
    if (filterTeam) data = data.filter((u) => u.teamId === filterTeam);

    data.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'role') {
        cmp = ROLE_ORDER[toSimpleRole(a.role)] - ROLE_ORDER[toSimpleRole(b.role)];
      } else if (sortKey === 'createdAt') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return data;
  }, [users, search, filterRole, filterTeam, sortKey, sortDir]);

  const totalCount = processedUsers.length;

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return processedUsers.slice(start, start + pageSize);
  }, [processedUsers, page, pageSize]);

  // ─── Sort ─────────────────────────────────────────────────────────────────

  const handleSort = (key: UserSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const SortTh = ({ k, label }: { k: UserSortKey; label: string }) => (
    <th
      scope="col"
      aria-label={label}
      onClick={() => handleSort(k)}
      className={cn(
        'cursor-pointer select-none px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors',
        sortKey === k
          ? 'text-brand'
          : 'text-ink-3 hover:text-ink',
      )}
    >
      <span className="flex items-center gap-1.5">
        {label}
        <SortIcon active={sortKey === k} dir={sortDir} />
      </span>
    </th>
  );

  // ─── Selection ────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const pageIds = paginatedUsers.map((u) => u.id);
    const allSel = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const allPageSelected =
    paginatedUsers.length > 0 && paginatedUsers.every((u) => selectedIds.has(u.id));
  const somePageSelected =
    !allPageSelected && paginatedUsers.some((u) => selectedIds.has(u.id));

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload: any = {
        name: formData.name,
        email: formData.email,
        role: simpleRoleToStored(formData.role),
        teamId: formData.teamId || null,
      };
      if (!editing || formData.password) payload.password = formData.password;

      if (editing) {
        await api.put(`/api/users/${editing.id}`, payload);
        success('User updated.');
      } else {
        if (!formData.password) {
          setFormError('Password is required for new users');
          setSaving(false);
          return;
        }
        await api.post('/api/users', payload);
        success('User created.');
      }
      setShowForm(false);
      setEditing(null);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const snapshot = users;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setConfirmDeleteId(null);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try {
      await api.delete(`/api/users/${id}`);
      success('User deleted.');
    } catch (err) {
      setUsers(snapshot);
      toastError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const snapshot = users;
    setUsers((prev) => prev.filter((u) => !selectedIds.has(u.id)));
    try {
      await Promise.allSettled(ids.map((id) => api.delete(`/api/users/${id}`)));
      success(`${ids.length} user${ids.length !== 1 ? 's' : ''} deleted.`);
    } catch {
      setUsers(snapshot);
      toastError('Some users could not be deleted.');
    } finally {
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      setBulkDeleting(false);
    }
  };

  // ─── Derived helpers ──────────────────────────────────────────────────────

  const advancedFilterCount = (filterRole ? 1 : 0) + (filterTeam ? 1 : 0);

  const clearAdvancedFilters = () => {
    setFilterRole('');
    setFilterTeam('');
    setPage(1);
  };

  const roleName = (r: SimpleRole) => t(`users.roles.${r}`, { defaultValue: SIMPLE_ROLE_LABEL[r] });

  if (status === 'loading' || !isManager(role)) return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      <PageHeader
        className="mb-0"
        title={t('users.title')}
        meta={<span className="chip chip-warn gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{t('badge')}</span>}
        description={t('users.subtitle')}
        actions={
          <button type="button" onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary inline-flex">
            <Plus className="h-4 w-4" />
            {t('users.newUser')}
          </button>
        }
      />

      {/* ── Table ── */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
          {/* Search */}
          <div className="relative min-w-0 flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input
              type="text"
              placeholder={t('users.searchPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="field h-10 w-full ps-10 pe-3"
            />
          </div>

          {/* Filter toggle */}
          <button
            type="button"
            onClick={() => setShowFilters((f) => !f)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
              showFilters || advancedFilterCount > 0
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-line bg-white dark:bg-white/5 text-ink-3 hover:bg-gray-50 dark:hover:bg-white/10',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">{t('common:actions.filter')}</span>
            {advancedFilterCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg">
                {advancedFilterCount}
              </span>
            )}
          </button>

          {/* Results + selection count */}
          <div className="flex w-full items-center gap-3 sm:ms-auto sm:w-auto">
            <span className="text-xs text-ink-3">
              {t('users.count', { count: totalCount })}
              {selectedIds.size > 0 && (
                <span className="ms-2 font-medium text-brand">· {t('users.selectedCount', { count: selectedIds.size })}</span>
              )}
            </span>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ms-auto text-xs font-medium text-ink-3 transition-colors hover:text-ink sm:ms-0"
              >
                {t('users.bulk.clearSelection')}
              </button>
            )}
          </div>
        </div>

        {/* Advanced filter panel */}
        {showFilters && (
          <div className="border-b border-line bg-canvas px-3 py-4 sm:px-5">
            <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap sm:gap-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-3">{t('users.filters.role')}</p>
                <select
                  value={filterRole}
                  onChange={(e) => { setFilterRole(e.target.value); setPage(1); }}
                  className="field w-full sm:w-auto"
                >
                  <option value="">{t('users.filters.allRoles')}</option>
                  {SIMPLE_ROLES.map((r) => (
                    <option key={r} value={r}>{roleName(r)}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-3">{t('users.filters.team')}</p>
                <select
                  value={filterTeam}
                  onChange={(e) => { setFilterTeam(e.target.value); setPage(1); }}
                  className="field w-full sm:w-auto"
                >
                  <option value="">{t('users.filters.allTeams')}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>
              {advancedFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAdvancedFilters}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-ink-3 hover:bg-raised transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> {t('users.filters.clear')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Phones: one row per person, tap to edit ── */}
        <ul className="divide-y divide-line sm:hidden">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-3.5">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-32 rounded" />
                  <div className="skeleton h-3 w-44 rounded" />
                </div>
              </li>
            ))
          ) : paginatedUsers.length === 0 ? (
            <li className="px-4 py-14 text-center">
              <UserCog className="mx-auto mb-3 h-8 w-8 text-ink-4" />
              <p className="text-sm text-ink-3">
                {search || advancedFilterCount > 0 ? t('users.noUsersFiltered') : t('users.noUsers')}
              </p>
            </li>
          ) : (
            paginatedUsers.map((u) => {
              const sel = selectedIds.has(u.id);
              const r = toSimpleRole(u.role);
              return (
                <li key={u.id} className={cn('relative transition-colors', sel && 'bg-brand/[0.06]')}>
                  {confirmDeleteId === u.id ? (
                    <div className="flex items-center gap-2 px-3 py-3.5">
                      <span className="flex-1 truncate text-sm text-red-500 dark:text-red-400">{t('users.deleteConfirm.inline')} <b className="font-semibold">{u.name}</b></span>
                      <button type="button" onClick={() => handleDelete(u.id)} className="btn btn-sm bg-red-600 text-white hover:bg-red-700">
                        {t('users.deleteConfirm.yes')}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="btn btn-secondary btn-sm">
                        {t('users.deleteConfirm.no')}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-3 pe-1 ps-3">
                      {/* Avatar doubles as the selection control, like WhatsApp's chat list */}
                      <button
                        type="button"
                        onClick={() => toggleSelect(u.id)}
                        aria-pressed={sel}
                        aria-label={u.name}
                        className={cn(
                          'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                          sel ? 'bg-brand text-brand-fg' : 'bg-brand/15 text-brand',
                        )}
                      >
                        {sel ? <Check className="h-5 w-5" strokeWidth={3} /> : u.name.charAt(0).toUpperCase()}
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (selectedIds.size > 0) toggleSelect(u.id); else { setEditing(u); setShowForm(true); } }}
                        className="min-w-0 flex-1 text-start"
                      >
                        <span className="flex items-center gap-2">
                          <span dir="auto" className="truncate text-[15px] font-medium text-ink">{u.name}</span>
                          <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', SIMPLE_ROLE_BADGE[r])}>
                            {roleName(r)}
                          </span>
                        </span>
                        <span dir="ltr" className="mt-0.5 block truncate text-start text-[13px] text-ink-3">{u.email}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {u.team?.name ?? t('users.noTeam')} · {t('users.joined', { date: new Date(u.createdAt).toLocaleDateString() })}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(u.id)}
                        aria-label={t('common:actions.delete')}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-red-500/10 hover:text-red-500 active:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-raised">
                <th scope="col" className="w-10 px-5 py-3.5">
                  <span className="sr-only">Select</span>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded border-line-strong accent-brand"
                  />
                </th>
                <SortTh k="name"      label={t('users.table.name')} />
                <SortTh k="email"     label={t('users.table.email')} />
                <SortTh k="role"      label={t('users.table.role')} />
                <th scope="col" className="px-5 py-3.5 text-start text-xs font-semibold uppercase tracking-wider text-ink-3">
                  {t('users.table.team')}
                </th>
                <SortTh k="createdAt" label={t('users.table.createdAt')} />
                <th scope="col" className="px-5 py-3.5"><span className="sr-only">{t('users.table.actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-4"><div className="h-4 w-4 rounded bg-gray-200 dark:bg-white/8" /></td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-white/8" />
                        <div className="h-4 w-28 rounded bg-gray-200 dark:bg-white/8" />
                      </div>
                    </td>
                    <td className="px-5 py-4"><div className="h-3 w-36 rounded bg-gray-200 dark:bg-white/5" /></td>
                    <td className="px-5 py-4"><div className="h-5 w-20 rounded-full bg-gray-200 dark:bg-white/8" /></td>
                    <td className="px-5 py-4"><div className="h-3 w-20 rounded bg-gray-200 dark:bg-white/5" /></td>
                    <td className="px-5 py-4"><div className="h-3 w-20 rounded bg-gray-200 dark:bg-white/5" /></td>
                    <td className="px-5 py-4"><div className="h-7 w-24 rounded bg-gray-200 dark:bg-white/5" /></td>
                  </tr>
                ))
              ) : paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <UserCog className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-ink-3/30" />
                    <p className="text-sm text-ink-3">
                      {search || advancedFilterCount > 0
                        ? t('users.noUsersFiltered')
                        : t('users.noUsers')}
                    </p>
                    {(search || advancedFilterCount > 0) && (
                      <button
                        type="button"
                        onClick={() => { setSearch(''); clearAdvancedFilters(); }}
                        className="mt-2 text-xs text-brand hover:underline"
                      >
                        {t('users.clearAllFilters')}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'group transition-colors hover:bg-raised/60',
                      selectedIds.has(u.id) && 'bg-brand/5 dark:bg-brand/8',
                    )}
                  >
                    <td className="w-10 px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        className="h-4 w-4 cursor-pointer rounded border-line-strong accent-brand"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-ink">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-3">{u.email}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', SIMPLE_ROLE_BADGE[toSimpleRole(u.role)])}>
                        {roleName(toSimpleRole(u.role))}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-3">
                      {u.team?.name ?? '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-3">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5">
                      {confirmDeleteId === u.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400 dark:text-red-300">{t('users.deleteConfirm.inline')}</span>
                          <button
                            type="button"
                            onClick={() => handleDelete(u.id)}
                            className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                          >
                            {t('users.deleteConfirm.yes')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="btn btn-secondary btn-sm"
                          >
                            {t('users.deleteConfirm.no')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => { setEditing(u); setShowForm(true); }}
                            className="btn btn-secondary btn-sm inline-flex"
                          >
                            <Pencil className="h-3 w-3" /> {t('common:actions.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(u.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" /> {t('common:actions.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="pop-enter fixed inset-x-3 bottom-[calc(var(--bottom-nav-space)+0.75rem)] z-40 flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 shadow-pop sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:gap-3 sm:px-4">
          <span className="me-auto text-sm font-semibold text-ink sm:me-0">
            {t('users.selectedCount', { count: selectedIds.size })}
          </span>
          <div className="hidden h-5 w-px bg-line sm:block" />
          {showBulkConfirm ? (
            <>
              <span className="text-xs font-medium text-red-500 dark:text-red-400">{t('users.bulk.deleteConfirm', { count: selectedIds.size })}</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? t('users.bulk.deleting') : t('users.bulk.yesDelete')}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(false)}
                className="btn btn-secondary btn-sm"
              >
                {t('users.bulk.cancel')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(true)}
                className="btn btn-sm inline-flex bg-red-600 text-white hover:bg-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t('users.bulk.delete')}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="btn btn-secondary btn-sm"
              >
                {t('users.bulk.clearSelection')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Create / Edit modal ── */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        aria-label={editing ? t('users.form.editTitle') : t('users.form.createTitle')}
        overlayClassName="bg-black/70"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-pop"
      >
          <form onSubmit={handleSubmit}>
            <div className="mb-5 flex items-center gap-3">
              <UserCog className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white">
                {editing ? t('users.form.editTitle') : t('users.form.createTitle')}
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('users.form.name')}</label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="field w-full"
                  placeholder="Ahmed Mohamed"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('users.form.email')}</label>
                <input
                  required
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="field w-full"
                  placeholder="ahmed@company.com"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">
                  {editing ? t('users.form.passwordEdit') : t('users.form.passwordCreate')}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="field w-full"
                  placeholder="••••••••"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('users.form.role')}</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as SimpleRole })}
                    className="field h-10 w-full"
                  >
                    {SIMPLE_ROLES.map((r) => <option key={r} value={r}>{SIMPLE_ROLE_LABEL[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('users.form.team')}</label>
                  <select
                    value={formData.teamId}
                    onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
                    className="field h-10 w-full"
                  >
                    <option value="">{t('users.form.noTeam')}</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {formError && <p className="mt-3 text-xs text-red-400">{formError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="btn btn-secondary"
              >
                {t('users.form.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? t('users.form.saving') : editing ? t('users.form.updateUser') : t('users.form.createUser')}
              </button>
            </div>
          </form>
      </Modal>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
