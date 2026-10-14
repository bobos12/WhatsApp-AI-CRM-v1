'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  Plus, Trash2, FileText, Pencil, Search, Copy,
  CheckCircle2, AlertTriangle, Sparkles, LayoutTemplate, Star, Send, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { api } from '../../../lib/api';
import PRESETS from '../../../lib/template-engine/presets';
import type { CanonicalTemplate } from '../../../lib/template-engine/schema';
import { isCanonicalPayload, TEMPLATE_CATEGORIES } from '../../../lib/template-engine/schema';
import SendTemplateDialog from '../../../components/templates/SendTemplateDialog';
import { ApprovalBadge, describeApproval, type MetaStatus } from '../../../components/templates/ApprovalStatus';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  type?: 'TEXT' | 'MEDIA';
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  category?: string | null;
  language?: string;
  payload?: any;
  variables?: string[];
  createdAt: string;
  // WhatsApp's verdict — the field that actually decides deliverability.
  metaStatus?: MetaStatus;
  metaRejectedReason?: string | null;
  metaSubmittedAt?: string | null;
  metaQualityScore?: string | null;
}

type Tab = 'library' | 'presets';

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeColor(type?: string) {
  if (type === 'MEDIA') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
}

const COLOR_MAP: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  sky:     'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  violet:  'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  amber:   'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  rose:    'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  orange:  'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
};

/**
 * "Needs approval" leads because it is the actionable one: it collects every
 * template that cannot currently be used in a campaign, which is the state a new
 * account is entirely in and the reason a broadcast refuses to send.
 */
const CATEGORY_FILTERS = ['All', 'Needs approval', 'Approved', ...TEMPLATE_CATEGORIES.map(c => c.value)];

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  t: template, onSend, onEdit, onDuplicate, onDelete, onSubmit, deleting, submitting,
}: {
  t: MessageTemplate;
  onSend: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
  onSubmit: () => void;
  deleting: boolean; submitting: boolean;
}) {
  const { t } = useTranslation('templates');
  const canonical = isCanonicalPayload(template.payload) ? template.payload as CanonicalTemplate : null;
  const vars: string[] = canonical?._meta?.variableNames ?? (Array.isArray(template.variables) ? template.variables : []);

  const preview = (template.content ?? '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\{\{(\w+)\}\}/g, '[$1]')
    .slice(0, 120);

  const categoryLabel = TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label ?? template.category;
  const approval = describeApproval(template, t as any);

  return (
    <div className="group rounded-xl border border-line bg-surface p-4 flex flex-col gap-3 hover:border-brand/40 hover:shadow-md transition-all">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink truncate">{template.name}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {/* Approval comes first: it is the only badge that determines whether
                this template can reach a campaign audience at all. */}
            <ApprovalBadge template={template} />
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColor(template.type)}`}>
              {template.type ?? 'TEXT'}
            </span>
            {categoryLabel && (
              <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
                {categoryLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content preview */}
      <p className="flex-1 text-sm text-ink-3 line-clamp-3 leading-relaxed">
        {preview || 'No content'}
      </p>

      {/* Variables */}
      {vars.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vars.slice(0, 3).map(v => (
            <span key={v} className="rounded-full bg-brand/10 border border-brand/20 px-1.5 py-0.5 text-[10px] font-mono text-brand">
              {`{{${v}}}`}
            </span>
          ))}
          {vars.length > 3 && (
            <span className="text-[10px] text-gray-400 self-center">+{vars.length - 3} more</span>
          )}
        </div>
      )}

      {/* Meta's rejection wording, verbatim. A rejection the tenant cannot read
          is a support ticket — and it is the only thing that says what to edit. */}
      {template.metaStatus === 'REJECTED' && template.metaRejectedReason && (
        <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
          {template.metaRejectedReason}
        </p>
      )}

      {/* Submit for review — shown only when submitting is the useful next step. */}
      {approval.canSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/20 disabled:opacity-60"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {submitting
            ? t('approval.submitting')
            : template.metaStatus === 'REJECTED'
              ? t('approval.resubmitShort')
              : t('approval.submitShort')}
        </button>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-1 border-t border-line">
        <button
          type="button"
          onClick={onSend}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand py-1.5 text-xs font-semibold text-brand-fg hover:bg-brand-strong transition-colors"
        >
          <Send className="h-3 w-3" /> {t('send.action', { defaultValue: 'Send' })}
        </button>

        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-white dark:bg-raised px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-brand/50 hover:bg-brand/5 transition-colors"
        >
          <Pencil className="h-3 w-3" /> {t('common:actions.edit')}
        </button>

        <button
          type="button"
          onClick={onDuplicate}
          className="btn btn-secondary btn-sm inline-flex justify-center"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="btn btn-secondary btn-sm inline-flex justify-center disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const router = useRouter();
  const { status } = useSession();
  const { t } = useTranslation('templates');

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [tab, setTab] = useState<Tab>('library');
  const [addingPreset, setAddingPreset] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sendTarget, setSendTarget] = useState<MessageTemplate | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/api/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') fetchTemplates();
  }, [fetchTemplates, status]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/api/templates/${id}`);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (tpl: MessageTemplate) => {
    try {
      await api.post('/api/templates', {
        name: `${tpl.name} (copy)`,
        content: tpl.content,
        type: tpl.type,
        payload: tpl.payload,
        variables: tpl.variables,
        category: tpl.category,
        language: tpl.language,
        status: 'PUBLISHED',
      });
      await fetchTemplates();
      showToast('Template duplicated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate');
    }
  };

  /**
   * Push a template to WhatsApp for review.
   *
   * The response carries Meta's immediate verdict, so the card is updated from
   * it rather than from an optimistic guess — Meta occasionally approves simple
   * utility templates synchronously, and claiming "in review" for something
   * already APPROVED would tell the user to wait for nothing.
   */
  const handleSubmit = async (tpl: MessageTemplate) => {
    setSubmittingId(tpl.id);
    try {
      const result = await api.post(`/api/templates/${tpl.id}/submit`, {});
      setTemplates(prev =>
        prev.map(item =>
          item.id === tpl.id
            ? {
                ...item,
                metaStatus: (result?.metaStatus ?? 'PENDING') as MetaStatus,
                metaRejectedReason: result?.metaRejectedReason ?? null,
                metaSubmittedAt: result?.metaSubmittedAt ?? new Date().toISOString(),
              }
            : item,
        ),
      );
      showToast(
        result?.metaStatus === 'APPROVED'
          ? t('approval.approvedToast', { name: tpl.name })
          : t('approval.submitted', { name: tpl.name }),
      );
    } catch (err) {
      // A rejection is not a failed request — the server persisted Meta's
      // verdict and reason before throwing. Re-reading is what puts REJECTED
      // and Meta's wording on the card; without it the only trace was a toast
      // that vanished in three seconds, so the card still read "Not submitted"
      // and the user had no idea anything had happened at all.
      await fetchTemplates();
      showToast(err instanceof Error ? err.message : t('approval.submitFailed'), 'error');
    } finally {
      setSubmittingId(null);
    }
  };

  /**
   * Re-read approval state from Meta.
   *
   * The webhook (`message_template_status_update`) is the normal path, but it is
   * the only one — a webhook missed while the server was down is never resent,
   * leaving a template stuck at PENDING in the CRM long after Meta approved it.
   * This is the manual repair for that.
   */
  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.post('/api/channel/templates/sync', {});
      await fetchTemplates();
      const count = typeof result?.synced === 'number' ? result.synced : null;
      showToast(count === null ? t('approval.syncedGeneric') : t('approval.syncedCount', { count }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('approval.syncFailed'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleUsePreset = async (preset: CanonicalTemplate) => {
    setAddingPreset(preset.name);
    try {
      await api.post('/api/templates', {
        name: preset.name,
        content: preset.body.text,
        type: preset.media ? 'MEDIA' : 'TEXT',
        payload: preset,
        variables: preset._meta?.variableNames ?? [],
        category: preset.category,
        language: preset.language,
        status: 'PUBLISHED',
      });
      await fetchTemplates();
      setTab('library');
      showToast(`"${preset.name}" added to your library`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add preset');
    } finally {
      setAddingPreset(null);
    }
  };

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = templates.filter(tpl => {
    const matchSearch = !search
      || tpl.name.toLowerCase().includes(search.toLowerCase())
      || tpl.content?.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All'
      ? true
      : categoryFilter === 'Needs approval'
      ? tpl.metaStatus !== 'APPROVED'
      : categoryFilter === 'Approved'
      ? tpl.metaStatus === 'APPROVED'
      : tpl.category === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg flex items-center gap-2 ${
          toast.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
            : 'bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/20 text-rose-700 dark:text-rose-400'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <section className="rounded-xl border border-line bg-white dark:bg-raised p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{t('title')}</h1>
            <p className="mt-1 text-sm text-ink-3">
              {t('mergedSubtitle', { defaultValue: 'Design once — text, media and tappable buttons — then send to anyone. Delivered exactly as previewed.' })}
            </p>
            {templates.length > 0 && (
              <p className="mt-2 text-xs text-ink-4">
                {templates.length} template{templates.length !== 1 ? 's' : ''} in your library
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              title={t('approval.syncTitle')}
              className="btn btn-secondary inline-flex disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? t('approval.syncing') : t('approval.sync')}</span>
            </button>
            <button
              type="button"
              onClick={() => router.push('/templates/builder')}
              className="btn btn-primary inline-flex"
            >
              <Plus className="h-4 w-4" /> {t('newTemplate')}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200 flex items-center justify-between">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1 w-fit">
        {([['library', 'My Templates'], ['presets', 'Preset Library']] as [Tab, string][]).map(([tabKey, label]) => (
          <button
            type="button"
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === tabKey ? 'bg-brand text-white' : 'text-ink-3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── My Templates ── */}
      {tab === 'library' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="field w-full pl-9 pr-4"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORY_FILTERS.map(cat => {
                const label = cat === 'All' ? 'All'
                  : cat === 'Needs approval' ? t('approval.filterNeedsApproval')
                  : cat === 'Approved' ? t('approval.filterApproved')
                  : TEMPLATE_CATEGORIES.find(c => c.value === cat)?.label ?? cat;
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${categoryFilter === cat ? 'bg-brand text-white border-brand' : 'border-line text-ink-3 hover:border-brand/50'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto text-xs text-ink-4">
              {filtered.length} template{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-48 rounded-xl border border-line bg-surface animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center">
              <FileText className="h-10 w-10 mx-auto text-gray-300 dark:text-white/10 mb-3" />
              <p className="text-sm font-medium text-ink-3">
                {search || categoryFilter !== 'All' ? t('noTemplates') : t('noTemplates')}
              </p>
              <p className="text-xs text-gray-400 mt-1 mb-4">
                {search || categoryFilter !== 'All'
                  ? 'Try a different search or filter'
                  : t('noTemplatesSubtitle')}
              </p>
              {!search && categoryFilter === 'All' && (
                <div className="flex gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() => router.push('/templates/builder')}
                    className="btn btn-primary inline-flex"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('newTemplate')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('presets')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm text-ink-3 hover:bg-raised transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> {t('presets.title')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(tpl => (
                <TemplateCard
                  key={tpl.id}
                  t={tpl}
                  onSend={() => setSendTarget(tpl)}
                  onEdit={() => router.push(`/templates/builder?id=${tpl.id}`)}
                  onDuplicate={() => handleDuplicate(tpl)}
                  onDelete={() => handleDelete(tpl.id)}
                  onSubmit={() => handleSubmit(tpl)}
                  deleting={deletingId === tpl.id}
                  submitting={submittingId === tpl.id}
                />
              ))}
              {/* Add new card */}
              <button
                type="button"
                onClick={() => router.push('/templates/builder')}
                className="rounded-xl border-2 border-dashed border-line bg-transparent p-4 flex flex-col items-center justify-center gap-2 hover:border-brand/50 hover:bg-brand/5 transition-colors text-ink-4 hover:text-brand min-h-[180px]"
              >
                <Plus className="h-8 w-8 opacity-50" />
                <p className="text-sm font-medium">{t('newTemplate')}</p>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Preset Library ── */}
      {tab === 'presets' && (
        <div className="space-y-6">
          {/* This used to promise "sendable with no approval required", which was
              true only of the unofficial transport that no longer exists. On the
              official API every one of these still needs Meta's approval, and
              saying otherwise sets up a failed campaign. */}
          <p className="text-sm text-ink-3">
            {t('approval.presetsIntro')}
          </p>
          {PRESETS.map(group => (
            <div key={group.category}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${COLOR_MAP[group.color] ?? ''}`}>
                  {group.category}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.templates.map(preset => {
                  const vars = preset._meta?.variableNames ?? [];
                  const type = preset.media ? 'MEDIA' : 'TEXT';
                  const alreadyInLibrary = templates.some(tpl => tpl.name === preset.name);

                  return (
                    <div
                      key={preset.name}
                      className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3 hover:border-brand/40 hover:shadow-md transition-all"
                    >
                      <div>
                        <p className="font-semibold text-ink">{preset.name}</p>
                        {preset._meta?.description && (
                          <p className="mt-0.5 text-[11px] text-ink-4 leading-snug">
                            {preset._meta.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColor(type)}`}>
                            {type}
                          </span>
                          <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
                            {TEMPLATE_CATEGORIES.find(c => c.value === preset.category)?.label ?? preset.category}
                          </span>
                          {vars.length > 0 && (
                            <span className="inline-flex rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[10px] font-mono text-brand">
                              {vars.length} var{vars.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {/* Not "WhatsApp-ready" — nothing is, until Meta approves it. */}
                          <span className="inline-flex rounded-full bg-raised border border-line px-2 py-0.5 text-[10px] text-ink-3">
                            {t('approval.presetsBadge')}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-ink-3 line-clamp-3 leading-relaxed flex-1">
                        {preset.body.text
                          .replace(/\*([^*]+)\*/g, '$1')
                          .replace(/\{\{(\w+)\}\}/g, '[$1]')}
                      </p>

                      {vars.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {vars.slice(0, 4).map(v => (
                            <span key={v} className="rounded-full bg-raised border border-line px-1.5 py-0.5 text-[10px] font-mono text-ink-3">
                              {`{{${v}}}`}
                            </span>
                          ))}
                          {vars.length > 4 && (
                            <span className="text-[10px] text-gray-400 self-center">+{vars.length - 4}</span>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleUsePreset(preset)}
                        disabled={addingPreset === preset.name || alreadyInLibrary}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          alreadyInLibrary
                            ? 'bg-raised border border-line text-gray-400 cursor-not-allowed'
                            : 'bg-brand/10 border border-brand/20 text-brand hover:bg-brand/20'
                        }`}
                      >
                        {alreadyInLibrary ? (
                          <><CheckCircle2 className="h-3 w-3" /> In Library</>
                        ) : addingPreset === preset.name ? (
                          'Adding…'
                        ) : (
                          <><Star className="h-3 w-3" /> {t('presets.use')}</>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Send dialog — the single place to send any template ── */}
      {sendTarget && (
        <SendTemplateDialog
          template={sendTarget}
          onClose={() => setSendTarget(null)}
          onSent={({ sent, failed }) => {
            if (failed > 0) {
              showToast(t('send.resultPartial', { defaultValue: 'Sent to {{sent}} — {{failed}} failed', sent, failed }), sent > 0 ? 'success' : 'error');
            } else {
              showToast(t('send.resultOk', { defaultValue: 'Sent to {{sent}} recipient(s)', sent }));
            }
          }}
        />
      )}
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
