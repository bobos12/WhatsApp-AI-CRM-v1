'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import {
  CheckSquare, Plus, Pencil, Trash2, X, Circle, Clock, CheckCircle2,
  SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { Input } from '../../../components/ui/input';
import { TablePagination } from '../../../components/ui/TablePagination';
import { Modal } from '../../../components/ui/modal';
import { cn } from '../../../lib/utils';
import { PageHeader } from '../../../components/ui/page';
import { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../hooks/useToast';
import { useRemembered } from '@/hooks/useRemembered';

type TaskStatus   = 'OPEN' | 'IN_PROGRESS' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
type TaskSortKey  = 'title' | 'priority' | 'dueDate' | 'status';

type Task = {
  id: string;
  title: string;
  contactId?: string | null;
  assigneeId?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  description?: string | null;
  contact?: { name?: string | null; phone: string };
  assignee?: { name?: string | null; email: string };
};

type ContactOption = { id: string; name: string | null; phone: string };
type MemberOption  = { id: string; name: string | null; email: string };

const STATUS_STYLES: Record<TaskStatus, string> = {
  OPEN:        'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-ink-3',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  DONE:        'bg-green-100 text-green-700 dark:bg-brand/15 dark:text-brand',
};

const STATUS_ICONS: Record<TaskStatus, React.ElementType> = {
  OPEN: Circle, IN_PROGRESS: Clock, DONE: CheckCircle2,
};

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  LOW:    'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-ink-3',
  MEDIUM: 'bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400',
  HIGH:   'bg-red-100 text-red-600 dark:bg-red-400/15 dark:text-red-400',
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: 'bg-gray-400', MEDIUM: 'bg-amber-400', HIGH: 'bg-red-400',
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
// System Manager tier (full access) — kept in sync with lib/roles MANAGER_ROLES.
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'];

const emptyForm = {
  contactId: '', assigneeId: '', title: '', description: '',
  dueDate: '', status: 'OPEN' as TaskStatus, priority: 'MEDIUM' as TaskPriority,
};

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  return new Date(task.dueDate) < new Date();
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-brand" />
    : <ArrowDown className="h-3 w-3 text-brand" />;
}

export default function TasksPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const { t } = useTranslation('tasks');
  const { t: tc } = useTranslation('common');
  const role    = (session?.user as any)?.role ?? 'AGENT';
  const isAdmin = ADMIN_ROLES.includes(role);

  // ─── data ─────────────────────────────────────────────────────────────────
  const [tasks, setTasks, firstTasks]       = useRemembered<Task[]>('tasks', []);
  const [contacts, setContacts] = useRemembered<ContactOption[]>('tasks:contacts', []);
  const [members, setMembers]   = useRemembered<MemberOption[]>('tasks:members', []);
  const [loading, setLoading]   = useState(firstTasks);

  // ─── form ─────────────────────────────────────────────────────────────────
  const [editingTask, setEditing] = useState<Task | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [formData, setFormData]   = useState(emptyForm);

  // ─── basic filter ─────────────────────────────────────────────────────────
  const [filterStatus, setFilter] = useState<TaskStatus | 'ALL'>('ALL');

  // ─── advanced filters ─────────────────────────────────────────────────────
  const [showFilters, setShowFilters]       = useState(false);
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'ALL'>('ALL');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [dueFrom, setDueFrom]               = useState('');
  const [dueTo, setDueTo]                   = useState('');

  // ─── sort ─────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<TaskSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ─── pagination ───────────────────────────────────────────────────────────
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ─── selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting]   = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<TaskStatus | null>(null);

  // ─── row confirm delete ───────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const presetContactId = searchParams.get('contactId');

  // ─── Load ─────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    try {
      const [taskData, contactData, agentData] = await Promise.all([
        api.get('/api/tasks'),
        api.get('/api/contacts'),
        api.get('/api/teams/agents'),
      ]);
      setTasks(Array.isArray(taskData) ? taskData : []);
      setContacts(Array.isArray(contactData) ? contactData : []);
      setMembers(Array.isArray(agentData) ? agentData : []);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!presetContactId || editingTask) return;
    setFormData((cur) => ({ ...cur, contactId: presetContactId }));
  }, [editingTask, presetContactId]);

  useEffect(() => {
    if (presetContactId && !editingTask) setShowForm(true);
  }, [editingTask, presetContactId]);

  useEffect(() => {
    if (editingTask) {
      setFormData({
        contactId:   editingTask.contactId   || '',
        assigneeId:  editingTask.assigneeId  || '',
        title:       editingTask.title,
        description: editingTask.description || '',
        dueDate:     editingTask.dueDate ? editingTask.dueDate.slice(0, 10) : '',
        status:      editingTask.status,
        priority:    editingTask.priority ?? 'MEDIUM',
      });
    } else {
      setFormData(emptyForm);
    }
  }, [editingTask, showForm]);

  useEffect(() => {
    if (!showForm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowForm(false); setEditing(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showForm]);

  const onTaskCreated = useCallback((task: Task) => {
    setTasks((prev) => prev.some((t) => t.id === task.id) ? prev : [task, ...prev]);
  }, []);
  const onTaskUpdated = useCallback((task: Task) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? task : t));
  }, []);
  const onTaskDeleted = useCallback(({ id }: { id: string }) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);
  useSocket('task:created', onTaskCreated);
  useSocket('task:updated', onTaskUpdated);
  useSocket('task:deleted', onTaskDeleted);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const processedTasks = useMemo(() => {
    let data = [...tasks];
    if (filterStatus !== 'ALL')   data = data.filter((task) => task.status === filterStatus);
    if (filterPriority !== 'ALL') data = data.filter((task) => task.priority === filterPriority);
    if (filterAssignee)           data = data.filter((task) => task.assigneeId === filterAssignee);
    if (dueFrom)                  data = data.filter((task) => task.dueDate && new Date(task.dueDate) >= new Date(dueFrom));
    if (dueTo)                    data = data.filter((task) => task.dueDate && new Date(task.dueDate) <= new Date(dueTo + 'T23:59:59'));
    if (sortKey) {
      data.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'priority') {
          cmp = PRIORITY_ORDER[a.priority ?? 'MEDIUM'] - PRIORITY_ORDER[b.priority ?? 'MEDIUM'];
        } else if (sortKey === 'dueDate') {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          cmp = ad - bd;
        } else {
          cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''));
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [tasks, filterStatus, filterPriority, filterAssignee, dueFrom, dueTo, sortKey, sortDir]);

  const totalCount = processedTasks.length;

  const paginatedTasks = useMemo(() => {
    const start = (page - 1) * pageSize;
    return processedTasks.slice(start, start + pageSize);
  }, [processedTasks, page, pageSize]);

  // ─── Stats ────────────────────────────────────────────────────────────────

  const openCount       = tasks.filter((task) => task.status === 'OPEN').length;
  const inProgressCount = tasks.filter((task) => task.status === 'IN_PROGRESS').length;
  const doneCount       = tasks.filter((task) => task.status === 'DONE').length;
  const overdueCount    = tasks.filter(isOverdue).length;

  // ─── Sort ─────────────────────────────────────────────────────────────────

  const handleSort = (key: TaskSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const SortTh = ({ k, label, className }: { k: TaskSortKey; label: string; className?: string }) => (
    <th
      scope="col"
      aria-label={label}
      onClick={() => handleSort(k)}
      className={cn(
        'cursor-pointer select-none px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider transition-colors',
        sortKey === k ? 'text-brand' : 'text-ink-3 hover:text-ink',
        className,
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
    const pageIds = paginatedTasks.map((task) => task.id);
    const allSel = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const allPageSelected =
    paginatedTasks.length > 0 && paginatedTasks.every((task) => selectedIds.has(task.id));
  const somePageSelected =
    !allPageSelected && paginatedTasks.some((task) => selectedIds.has(task.id));

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        title:       formData.title,
        description: formData.description || undefined,
        dueDate:     formData.dueDate ? new Date(formData.dueDate).toISOString() : undefined,
        status:      formData.status,
        priority:    formData.priority,
        contactId:   formData.contactId  || undefined,
        assigneeId:  formData.assigneeId || undefined,
      };
      if (editingTask) {
        await api.put(`/api/tasks/${editingTask.id}`, payload);
        success('Task updated.');
      } else {
        await api.post('/api/tasks', payload);
        success('Task created.');
      }
      setShowForm(false);
      setEditing(null);
      await loadAll();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const snapshot = tasks;
    setTasks((prev) => prev.filter((task) => task.id !== id));
    setConfirmDeleteId(null);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try {
      await api.delete(`/api/tasks/${id}`);
      success('Task deleted.');
    } catch (err) {
      setTasks(snapshot);
      toastError(err instanceof Error ? err.message : 'Failed to delete task');
    }
  };

  const handleStatusChange = async (task: Task, status: TaskStatus) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status } : t));
    try {
      await api.put(`/api/tasks/${task.id}`, { status });
    } catch (err) {
      setTasks((prev) => prev.map((t) => t.id === task.id ? task : t));
      toastError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const snapshot = tasks;
    setTasks((prev) => prev.filter((task) => !selectedIds.has(task.id)));
    try {
      await Promise.allSettled(ids.map((id) => api.delete(`/api/tasks/${id}`)));
      success(`${ids.length} task${ids.length !== 1 ? 's' : ''} deleted.`);
    } catch {
      setTasks(snapshot);
      toastError('Some tasks could not be deleted.');
    } finally {
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      setBulkDeleting(false);
    }
  };

  const handleBulkStatusChange = async (status: TaskStatus) => {
    const ids = Array.from(selectedIds);
    setTasks((prev) => prev.map((task) => selectedIds.has(task.id) ? { ...task, status } : task));
    setBulkStatusTarget(null);
    try {
      await Promise.allSettled(ids.map((id) => api.put(`/api/tasks/${id}`, { status })));
      success(`${ids.length} task${ids.length !== 1 ? 's' : ''} updated to ${t(`status.${status}`)}.`);
    } catch {
      toastError('Some tasks could not be updated.');
    }
  };

  // ─── Derived helpers ──────────────────────────────────────────────────────

  const advancedFilterCount =
    (filterPriority !== 'ALL' ? 1 : 0) +
    (filterAssignee ? 1 : 0) +
    (dueFrom ? 1 : 0) +
    (dueTo ? 1 : 0);

  const clearAdvancedFilters = () => {
    setFilterPriority('ALL');
    setFilterAssignee('');
    setDueFrom('');
    setDueTo('');
    setPage(1);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      <PageHeader
        title={t('title')}
        description={isAdmin ? t('adminSubtitle') : t('agentSubtitle')}
        actions={
          <button type="button" onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary">
            <Plus aria-hidden="true" />
            {t('newTask')}
          </button>
        }
      />

      {/* Status filter doubles as the count summary — one control, not two. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg max-w-full overflow-x-auto scrollbar-none">
          {([
            { key: 'ALL', label: t('filters.allStatuses'), count: openCount + inProgressCount + doneCount },
            { key: 'OPEN', label: t('status.OPEN'), count: openCount },
            { key: 'IN_PROGRESS', label: t('status.IN_PROGRESS'), count: inProgressCount },
            { key: 'DONE', label: t('status.DONE'), count: doneCount },
          ] as const).map((s) => (
            <button key={s.key} type="button" data-active={filterStatus === s.key} onClick={() => { setFilter(s.key as any); setPage(1); }} className="seg-item">
              {s.label}
              <span className="tabular-nums text-ink-4">{s.count}</span>
            </button>
          ))}
        </div>
        {overdueCount > 0 && <span className="chip chip-danger h-6 px-2">{overdueCount} {t('overdue')}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setShowFilters((f) => !f)}
          aria-expanded={showFilters}
          className={cn('btn btn-secondary', (showFilters || advancedFilterCount > 0) && 'border-brand/40 text-brand')}
        >
          <SlidersHorizontal aria-hidden="true" />
          {t('common:actions.filter')}
          {advancedFilterCount > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-fg">
              {advancedFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Advanced filter panel ── */}
      {showFilters && (
        <div className="rounded-xl border border-line bg-surface px-5 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('filters.priority')}</p>
              <select
                value={filterPriority}
                onChange={(e) => { setFilterPriority(e.target.value as any); setPage(1); }}
                className="field w-auto"
              >
                <option value="ALL">{t('filters.allPriorities')}</option>
                <option value="HIGH">{t('priority.HIGH')}</option>
                <option value="MEDIUM">{t('priority.MEDIUM')}</option>
                <option value="LOW">{t('priority.LOW')}</option>
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('filters.assignee')}</p>
              <select
                value={filterAssignee}
                onChange={(e) => { setFilterAssignee(e.target.value); setPage(1); }}
                className="field w-auto"
              >
                <option value="">{t('filters.allAssignees')}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('filters.dueFrom')}</p>
              <input
                type="date"
                value={dueFrom}
                onChange={(e) => { setDueFrom(e.target.value); setPage(1); }}
                className="field w-auto"
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('filters.dueTo')}</p>
              <input
                type="date"
                value={dueTo}
                onChange={(e) => { setDueTo(e.target.value); setPage(1); }}
                className="field w-auto"
              />
            </div>
            {advancedFilterCount > 0 && (
              <button
                type="button"
                onClick={clearAdvancedFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-ink-3 hover:bg-raised transition-colors"
              >
                <X className="h-3.5 w-3.5" /> {t('filters.clear')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Task table ── */}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">

        {/* Results info */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <p className="text-xs text-ink-3">
            {totalCount} {totalCount === 1 ? t('title').toLowerCase().replace(/s$/, '') : t('title').toLowerCase()}
            {selectedIds.size > 0 && (
              <span className="ml-2 font-medium text-brand">· {selectedIds.size} selected</span>
            )}
          </p>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-ink-3 hover:text-ink transition-colors"
            >
              {t('bulk.clearSelection')}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
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
                    className="h-4 w-4 cursor-pointer rounded border-white/20 accent-brand"
                  />
                </th>
                <SortTh k="title"    label={t('table.title')} />
                <SortTh k="priority" label={t('table.priority')} />
                <th scope="col" className="px-5 py-3.5 text-start text-xs font-semibold uppercase tracking-wider text-ink-3">{t('table.contact')}</th>
                <th scope="col" className="px-5 py-3.5 text-start text-xs font-semibold uppercase tracking-wider text-ink-3">{t('table.assignedTo')}</th>
                <SortTh k="dueDate" label={t('table.dueDate')} />
                <SortTh k="status"  label={t('table.status')} />
                <th scope="col" className="px-5 py-3.5"><span className="sr-only">{t('table.actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-4"><div className="h-4 w-4 rounded bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-5 py-4"><div className="h-4 w-48 rounded bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-5 py-4"><div className="h-5 w-16 rounded-full bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-5 py-4"><div className="h-3 w-24 rounded bg-raised" /></td>
                    <td className="px-5 py-4"><div className="h-3 w-20 rounded bg-raised" /></td>
                    <td className="px-5 py-4"><div className="h-3 w-20 rounded bg-raised" /></td>
                    <td className="px-5 py-4"><div className="h-6 w-24 rounded-full bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-5 py-4"><div className="h-7 w-20 rounded bg-raised" /></td>
                  </tr>
                ))
              ) : paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <CheckSquare className="mx-auto mb-3 h-8 w-8 text-ink-4/30" />
                    <p className="text-sm text-ink-3">
                      {filterStatus === 'ALL' && advancedFilterCount === 0
                        ? t('noTasks')
                        : t('noResults')}
                    </p>
                    {(filterStatus !== 'ALL' || advancedFilterCount > 0) && (
                      <button
                        type="button"
                        onClick={() => { setFilter('ALL'); clearAdvancedFilters(); }}
                        className="mt-2 text-xs text-brand hover:underline"
                      >
                        {t('clearAllFilters')}
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task) => {
                  const overdue = isOverdue(task);
                  return (
                    <tr
                      key={task.id}
                      className={cn(
                        'group transition-colors hover:bg-raised/60',
                        selectedIds.has(task.id) && 'bg-brand/8',
                      )}
                    >
                      <td className="w-10 px-5 py-3.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(task.id)}
                          onChange={() => toggleSelect(task.id)}
                          className="h-4 w-4 cursor-pointer rounded border-white/20 accent-brand"
                        />
                      </td>
                      <td className="px-5 py-3.5 max-w-[240px]">
                        <p className={cn('text-sm font-medium text-ink', overdue && 'text-red-300')}>
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="mt-0.5 truncate text-xs text-ink-3">{task.description}</p>
                        )}
                        {overdue && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-red-400">
                            <Clock className="h-2.5 w-2.5" /> {t('overdue')}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', PRIORITY_STYLES[task.priority ?? 'MEDIUM'])}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[task.priority ?? 'MEDIUM'])} />
                          {t(`priority.${task.priority ?? 'MEDIUM'}`)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-ink-3">
                        {task.contact?.name || task.contact?.phone || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-ink-3">
                        {task.assignee?.name || task.assignee?.email || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-ink-3">
                        {task.dueDate
                          ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        {confirmDeleteId === task.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-300">{t('deleteConfirm.inline')}</span>
                            <button type="button" onClick={() => handleDelete(task.id)} className="btn btn-sm bg-red-600 text-white hover:bg-red-700">{t('deleteConfirm.yes')}</button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)} className="btn btn-secondary btn-sm">{t('deleteConfirm.no')}</button>
                          </div>
                        ) : (
                          <select
                            value={task.status}
                            onChange={(e) => handleStatusChange(task, e.target.value as TaskStatus)}
                            className={cn('cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none', STATUS_STYLES[task.status])}
                          >
                            <option value="OPEN">{t('status.OPEN')}</option>
                            <option value="IN_PROGRESS">{t('status.IN_PROGRESS')}</option>
                            <option value="DONE">{t('status.DONE')}</option>
                          </select>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {confirmDeleteId !== task.id && (
                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => { setEditing(task); setShowForm(true); }}
                              className="btn btn-secondary btn-sm inline-flex"
                            >
                              <Pencil className="h-3 w-3" /> {t('common:actions.edit')}
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(task.id)}
                                className="inline-flex items-center rounded-lg border border-red-400/20 bg-red-400/8 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-400/15 transition-colors"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
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
        <div className="fixed bottom-[var(--bottom-nav-space)] sm:bottom-6 left-1/2 z-40 -translate-x-1/2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white dark:bg-raised px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <span className="text-sm font-medium text-ink">
            {selectedIds.size} {selectedIds.size === 1 ? t('title').toLowerCase().replace(/s$/, '') : t('title').toLowerCase()} selected
          </span>
          <div className="h-5 w-px bg-gray-200 dark:bg-white/15" />

          {/* Bulk status change */}
          {bulkStatusTarget ? (
            <>
              <span className="text-xs text-ink-3">
                {t('bulk.markAsConfirm', { status: t(`status.${bulkStatusTarget}`) })}
              </span>
              <button
                type="button"
                onClick={() => handleBulkStatusChange(bulkStatusTarget)}
                className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
              >
                {t('bulk.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setBulkStatusTarget(null)}
                className="btn btn-secondary btn-sm"
              >
                {t('bulk.cancel')}
              </button>
            </>
          ) : showBulkConfirm ? (
            <>
              <span className="text-xs text-red-300">{t('bulk.deleteConfirm', { count: selectedIds.size })}</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? t('bulk.deleting') : t('bulk.yesDelete')}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(false)}
                className="btn btn-secondary btn-sm"
              >
                {t('bulk.cancel')}
              </button>
            </>
          ) : (
            <>
              <select
                value=""
                onChange={(e) => e.target.value && setBulkStatusTarget(e.target.value as TaskStatus)}
                className="h-7 rounded-lg border border-line bg-gray-50 dark:bg-surface px-2 text-xs text-ink-3 outline-none"
              >
                <option value="">{t('bulk.markAs')}</option>
                <option value="OPEN">{t('status.OPEN')}</option>
                <option value="IN_PROGRESS">{t('status.IN_PROGRESS')}</option>
                <option value="DONE">{t('status.DONE')}</option>
              </select>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowBulkConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t('bulk.delete')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="btn btn-secondary btn-sm"
              >
                {t('common:actions.deselectAll')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        aria-label={editingTask ? t('form.editTitle') : t('form.createTitle')}
        overlayClassName="bg-black/75"
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-pop"
      >
          <form onSubmit={handleSubmit}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-ink">{editingTask ? t('form.editTitle') : t('form.createTitle')}</h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditing(null); }}
                aria-label={tc('actions.close')}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.taskTitle')}</label>
                <Input
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={t('form.titlePlaceholder')}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.description')}</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  placeholder={t('form.descriptionPlaceholder')}
                  className="field w-full resize-none transition-colors"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.contact')}</label>
                <select
                  value={formData.contactId}
                  onChange={(e) => setFormData({ ...formData, contactId: e.target.value })}
                  className="field h-10 w-full transition-colors"
                >
                  <option value="">{t('form.noContact')}</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || c.phone}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.priority')}</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
                    className="field h-10 w-full transition-colors"
                  >
                    <option value="LOW">{t('priority.LOW')}</option>
                    <option value="MEDIUM">{t('priority.MEDIUM')}</option>
                    <option value="HIGH">{t('priority.HIGH')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.status')}</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                    className="field h-10 w-full transition-colors"
                  >
                    <option value="OPEN">{t('status.OPEN')}</option>
                    <option value="IN_PROGRESS">{t('status.IN_PROGRESS')}</option>
                    <option value="DONE">{t('status.DONE')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.dueDate')}</label>
                  <Input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-3">{t('form.assignedTo')}</label>
                <select
                  value={formData.assigneeId}
                  onChange={(e) => setFormData({ ...formData, assigneeId: e.target.value })}
                  className="field h-10 w-full transition-colors"
                >
                  <option value="">{t('form.unassigned')}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="btn btn-secondary"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? t('form.saving') : editingTask ? t('form.updateTask') : t('form.createTask')}
              </button>
            </div>
          </form>
      </Modal>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn('h-3.5 w-3.5', className)} />
      <span className="text-xs text-ink-3">{label}</span>
      <span className={cn('text-sm font-bold', className)}>{value}</span>
    </div>
  );
}
