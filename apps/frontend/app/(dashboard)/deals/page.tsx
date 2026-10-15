'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BriefcaseBusiness, Plus, Pencil, Trash2, ChevronRight, X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { Input } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
import { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../hooks/useToast';
import { cn } from '../../../lib/utils';
import { STAGE_TONE } from '../../../lib/format';
import { PageHeader } from '../../../components/ui/page';
import { Skeleton } from '../../../components/ui/Skeleton';
import Avatar from '../../../components/ui/Avatar';
import { useRemembered } from '@/hooks/useRemembered';

type Stage = 'NEW' | 'INTERESTED' | 'NEGOTIATION' | 'CLOSED';

type Deal = {
  id: string;
  title: string;
  contactId?: string | null;
  ownerId?: string | null;
  stage: Stage;
  value: number;
  notes?: string | null;
  updatedAt: string;
  contact?: { name?: string | null; phone: string };
  owner?: { name?: string | null; email: string };
};

type ContactOption = { id: string; name: string | null; phone: string };
type MemberOption  = { id: string; name: string | null; email: string };

const STAGES: Stage[] = ['NEW', 'INTERESTED', 'NEGOTIATION', 'CLOSED'];

const STAGE_CFG: Record<Stage, {
  bar: string;
  badge: string;
}> = {
  NEW:         { bar: 'bg-blue-500',   badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20'      },
  INTERESTED:  { bar: 'bg-violet-500', badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  NEGOTIATION: { bar: 'bg-amber-500',  badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20'    },
  CLOSED:      { bar: 'bg-brand',  badge: 'bg-brand/10 text-brand border-brand/20'   },
};

function timeAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('timeAgo.justNow');
  if (min < 60) return t('timeAgo.minutesAgo', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('timeAgo.hoursAgo', { count: h });
  return t('timeAgo.daysAgo', { count: Math.floor(h / 24) });
}

function initial(s?: string | null): string {
  return (s ?? '?').charAt(0).toUpperCase();
}

function SkeletonCard() {
  return (
    <div className="rounded-lg bg-surface p-3 shadow-soft ring-1 ring-line">
      <Skeleton className="h-3.5 w-2/3 rounded" />
      <Skeleton className="mt-3 h-3 w-1/2 rounded" />
      <Skeleton className="mt-3 h-6 w-24 rounded-md" />
    </div>
  );
}

function DealCard({
  deal, confirmDeleteId, deletingId,
  onEdit, onAdvance, onRequestDelete, onCancelDelete, onConfirmDelete,
}: {
  deal: Deal;
  confirmDeleteId: string | null;
  deletingId: string | null;
  onEdit: () => void;
  onAdvance: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useTranslation('deals');
  const { t: tc } = useTranslation('common');
  const idx = STAGES.indexOf(deal.stage);
  const isLast = idx === STAGES.length - 1;
  const nextStageKey = !isLast ? STAGES[idx + 1] : null;
  const nextLabel = nextStageKey ? t(`stages.${nextStageKey}`) : null;
  const isConfirming = confirmDeleteId === deal.id;
  const isDeleting = deletingId === deal.id;
  const who = deal.contact?.name || deal.contact?.phone || t('noContact');

  return (
    <article
      className={cn(
        'lift group cursor-pointer rounded-lg bg-surface p-3 shadow-soft ring-1',
        isConfirming ? 'ring-red-300 dark:ring-red-500/40' : 'ring-line',
      )}
      onClick={() => { if (!isConfirming) onEdit(); }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-ink">{deal.title}</p>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">${Number(deal.value || 0).toLocaleString()}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-ink-3">
        <Avatar name={deal.contact?.name || deal.contact?.phone || '?'} size={20} />
        <span className="truncate">{who}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-2xs text-ink-4">
        <span className="truncate">{deal.owner ? (deal.owner.name || deal.owner.email) : t('unassigned')}</span>
        <span className="shrink-0 tabular-nums">{timeAgo(deal.updatedAt, t)}</span>
      </div>

      {isConfirming ? (
        <div className="mt-3 rounded-md bg-red-50 p-2.5 dark:bg-red-500/10" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs font-semibold text-red-700 dark:text-red-300">{t('deleteConfirm.title')}</p>
          <p className="mt-0.5 text-2xs leading-4 text-red-700/80 dark:text-red-300/80">{t('deleteConfirm.message', { title: deal.title })}</p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }} className="btn btn-sm h-7 bg-red-600 text-white hover:bg-red-700">
              {t('deleteConfirm.confirm')}
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onCancelDelete(); }} className="btn btn-secondary btn-sm h-7">
              {t('deleteConfirm.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-1 border-t border-line pt-2.5" onClick={(e) => e.stopPropagation()}>
          {!isLast && (
            <button type="button" onClick={onAdvance} className="btn btn-sm h-7 bg-brand/10 px-2 text-brand hover:bg-brand/15">
              {nextLabel}
              <ChevronRight className="icon-mirror" aria-hidden="true" />
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onEdit} className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label={tc('actions.edit')} title={tc('actions.edit')}>
            <Pencil aria-hidden="true" />
          </button>
          <button type="button" onClick={onRequestDelete} disabled={isDeleting} className="btn btn-ghost btn-icon btn-sm h-7 w-7 hover:text-red-600" aria-label={tc('actions.delete')} title={tc('actions.delete')}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}

const emptyForm = { contactId: '', ownerId: '', title: '', stage: 'NEW' as Stage, value: '', notes: '' };

export default function DealsPage() {
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const { t } = useTranslation('deals');
  const { t: tc } = useTranslation('common');

  const [deals, setDeals, firstDeals]               = useRemembered<Deal[]>('deals', []);
  const [loading, setLoading]           = useState(firstDeals);
  const [editingDeal, setEditingDeal]   = useState<Deal | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [saving, setSaving]             = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [confirmDeleteId, setConfirmId] = useState<string | null>(null);
  const [contacts, setContacts]         = useRemembered<ContactOption[]>('deals:contacts', []);
  const [members, setMembers]           = useRemembered<MemberOption[]>('deals:members', []);
  const [formData, setFormData]         = useState(emptyForm);

  const presetContactId = searchParams.get('contactId');

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [dealData, contactData, agentData] = await Promise.all([
          api.get('/api/deals'),
          api.get('/api/contacts'),
          api.get('/api/teams/agents'),
        ]);
        setDeals(Array.isArray(dealData) ? dealData : []);
        setContacts(Array.isArray(contactData) ? contactData : []);
        setMembers(Array.isArray(agentData) ? agentData : []);
      } catch (err) {
        toastError(err instanceof Error ? err.message : t('toast.loadFailed'));
        setDeals([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Open form with preset contact when navigating from chat window
  useEffect(() => {
    if (presetContactId && !editingDeal) setShowForm(true);
  }, [editingDeal, presetContactId]);

  // Sync form with editing deal (or preset contact for new deals)
  useEffect(() => {
    if (editingDeal) {
      setFormData({
        contactId: editingDeal.contactId || '',
        ownerId:   editingDeal.ownerId   || '',
        title:     editingDeal.title,
        stage:     editingDeal.stage,
        value:     String(editingDeal.value ?? 0),
        notes:     editingDeal.notes     || '',
      });
    } else {
      // Preserve the URL-preset contactId so chat-window → deal flow auto-fills the customer
      setFormData({ ...emptyForm, contactId: presetContactId || '' });
    }
  }, [editingDeal, showForm, presetContactId]);

  // Realtime socket handlers
  const onDealCreated = useCallback(({ deal }: { deal: Deal }) => {
    setDeals((prev) => prev.some((d) => d.id === deal.id) ? prev : [deal, ...prev]);
  }, []);
  const onDealUpdated = useCallback(({ deal }: { deal: Deal }) => {
    // Upsert: an update (e.g. a stage change or re-assignment) may bring a deal
    // into view that wasn't in the current list, so add it if missing.
    setDeals((prev) =>
      prev.some((d) => d.id === deal.id)
        ? prev.map((d) => (d.id === deal.id ? deal : d))
        : [deal, ...prev],
    );
  }, []);
  const onDealDeleted = useCallback(({ dealId }: { dealId: string }) => {
    setDeals((prev) => prev.filter((d) => d.id !== dealId));
  }, []);
  useSocket('deal:created', onDealCreated);
  useSocket('deal:updated', onDealUpdated);
  useSocket('deal:deleted', onDealDeleted);

  // Submit create/update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        contactId: formData.contactId || undefined,
        ownerId:   formData.ownerId   || undefined,
        title:     formData.title,
        stage:     formData.stage,
        value:     Number(formData.value || 0),
        notes:     formData.notes,
      };
      if (editingDeal) {
        await api.put(`/api/deals/${editingDeal.id}`, payload);
        success(t('toast.updated'));
      } else {
        await api.post('/api/deals', payload);
        success(t('toast.created'));
      }
      const data = await api.get('/api/deals');
      setDeals(Array.isArray(data) ? data : []);
      setShowForm(false);
      setEditingDeal(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Delete deal (optimistic)
  const handleDelete = async (id: string) => {
    const snapshot = deals;
    setDeals((prev) => prev.filter((d) => d.id !== id));
    setConfirmId(null);
    setDeletingId(id);
    try {
      await api.delete(`/api/deals/${id}`);
      success(t('toast.deleted'));
    } catch (err) {
      setDeals(snapshot);
      toastError(err instanceof Error ? err.message : t('toast.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  // Advance to next stage (optimistic)
  const handleAdvanceStage = async (deal: Deal) => {
    const idx = STAGES.indexOf(deal.stage);
    if (idx === STAGES.length - 1) return;
    const nextStage = STAGES[idx + 1];
    setDeals((prev) => prev.map((d) => d.id === deal.id ? { ...d, stage: nextStage } : d));
    try {
      await api.put(`/api/deals/${deal.id}`, { stage: nextStage });
    } catch (err) {
      setDeals((prev) => prev.map((d) => d.id === deal.id ? deal : d));
      toastError(err instanceof Error ? err.message : t('toast.advanceFailed'));
    }
  };

  // Computed pipeline stats
  const totalDeals  = deals.length;
  const totalValue  = deals.reduce((s, d) => s + (d.value || 0), 0);
  const closedDeals = deals.filter((d) => d.stage === 'CLOSED');
  const closedValue = closedDeals.reduce((s, d) => s + (d.value || 0), 0);
  const winRate     = totalDeals > 0 ? Math.round((closedDeals.length / totalDeals) * 100) : 0;

  const columns = STAGES.map((stage) => ({
    stage,
    cfg:   STAGE_CFG[stage],
    label: t(`stages.${stage}`),
    emptyText: t(`emptyStage.${stage}`),
    items: deals.filter((d) => d.stage === stage),
    total: deals.filter((d) => d.stage === stage).reduce((s, d) => s + (d.value || 0), 0),
  }));

  return (
    <div className="space-y-6">

      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <button type="button" onClick={() => { setEditingDeal(null); setShowForm(true); }} className="btn btn-primary">
            <Plus aria-hidden="true" />
            {t('newDeal')}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-5 sm:grid-cols-4">
        {[
          { label: t('totalDeals'), value: String(totalDeals) },
          { label: t('pipeline'), value: `$${totalValue.toLocaleString()}` },
          { label: t('won'), value: `$${closedValue.toLocaleString()}`, tone: 'text-brand' },
          { label: t('winRate'), value: `${winRate}%` },
        ].map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="truncate text-2xs font-medium text-ink-3">{s.label}</p>
            <p className={cn('mt-1 truncate text-2xl font-semibold tabular-nums tracking-[-0.02em]', s.tone ?? 'text-ink')}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Board ── */}
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-4">
        {columns.map(({ stage, label, emptyText, items, total }) => (
          <div key={stage} className="flex min-h-[320px] w-[78vw] shrink-0 snap-start flex-col rounded-xl bg-raised/60 ring-1 ring-inset ring-line sm:w-auto">
            <div className="flex items-center justify-between gap-2 px-3.5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_TONE[stage]?.dot)} aria-hidden="true" />
                <span className="truncate text-[13px] font-semibold text-ink">{label}</span>
                <span className="text-2xs tabular-nums text-ink-4">{items.length}</span>
              </div>
              <span className="text-xs tabular-nums text-ink-3">${total.toLocaleString()}</span>
            </div>

            <div className="stagger flex-1 space-y-2 px-2 pb-2">
              {loading ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-3 py-10 text-center">
                  <p className="text-xs text-ink-3">{emptyText}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDeal(null);
                      setFormData((c) => ({ ...emptyForm, stage, contactId: c.contactId }));
                      setShowForm(true);
                    }}
                    className="btn btn-ghost btn-sm mt-2"
                  >
                    <Plus aria-hidden="true" /> {t('addDeal')}
                  </button>
                </div>
              ) : (
                items.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    confirmDeleteId={confirmDeleteId}
                    deletingId={deletingId}
                    onEdit={() => { setEditingDeal(deal); setShowForm(true); }}
                    onAdvance={() => handleAdvanceStage(deal)}
                    onRequestDelete={() => setConfirmId(confirmDeleteId === deal.id ? null : deal.id)}
                    onCancelDelete={() => setConfirmId(null)}
                    onConfirmDelete={() => handleDelete(deal.id)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Create / Edit Modal ── */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditingDeal(null); }}
        aria-label={editingDeal ? t('editDeal') : t('newDeal')}
        className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-pop"
      >
          <form onSubmit={handleSubmit}>
            {/* Modal header */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">
                {editingDeal ? t('editDeal') : t('newDeal')}
              </h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingDeal(null); }}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <Field label={t('form.contact')}>
                <select
                  value={formData.contactId}
                  onChange={(e) => setFormData({ ...formData, contactId: e.target.value })}
                  className="field h-10 w-full transition-colors"
                >
                  <option value="">{t('form.selectContact')}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.phone}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('form.title')}>
                <Input
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={t('form.titlePlaceholder')}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t('form.stage')}>
                  <select
                    value={formData.stage}
                    onChange={(e) => setFormData({ ...formData, stage: e.target.value as Stage })}
                    className="field h-10 w-full transition-colors"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>{t(`stages.${s}`)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('form.value')}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              </div>

              <Field label={t('form.assignedTo')}>
                <select
                  value={formData.ownerId}
                  onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                  className="field h-10 w-full transition-colors"
                >
                  <option value="">{t('form.unassigned')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.email}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('form.notes')}>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder={t('form.notesPlaceholder')}
                  className="field w-full resize-none transition-colors"
                />
              </Field>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingDeal(null); }}
                className="btn btn-secondary"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? t('form.saving') : editingDeal ? t('form.update') : t('form.create')}
              </button>
            </div>
          </form>
      </Modal>
    </div>
  );
}

/* ── Small helpers ── */

function Stat({ value, label, highlight }: { value: string | number; label: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-xl font-bold', highlight ? 'text-brand' : 'text-ink')}>
        {value}
      </p>
      <p className="text-xs text-ink-3">{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
