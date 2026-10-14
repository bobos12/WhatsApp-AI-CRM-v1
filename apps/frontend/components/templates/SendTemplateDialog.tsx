'use client';

/**
 * SendTemplateDialog — the single place to send a designed template.
 *
 * One simple flow: pick recipients → (optionally) fill variables → send.
 * {{name}}, {{first_name}} and {{phone}} are filled automatically per contact.
 * The preview bubble shows exactly what arrives on WhatsApp — the backend
 * sends the same structure natively (header + body + footer + real buttons).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X, Search, Send, Users, MessageCircle, Loader2, CheckCircle2, AtSign,
} from 'lucide-react';
import { api } from '../../lib/api';
import FriendlyError from '../ui/FriendlyError';
import { groupErrors } from '../../lib/friendly-error';
import { formatPhone } from '../../lib/phone';
import type { CanonicalTemplate } from '../../lib/template-engine/schema';
import { isCanonicalPayload } from '../../lib/template-engine/schema';
import { toRenderable, extractVariableNames } from '../../lib/template-engine/compiler';

// Variables resolved automatically from each contact — never asked from the user.
const AUTO_VARS = new Set(['name', 'first_name', 'phone']);

interface ConversationEntry {
  id: string;
  contact: { id: string; name: string | null; phone: string } | null;
}

export interface SendableTemplate {
  id: string;
  name: string;
  content: string;
  language?: string;
  category?: string | null;
  payload?: any;
  variables?: string[];
}

function toCanonical(template: SendableTemplate): CanonicalTemplate {
  if (isCanonicalPayload(template.payload)) return template.payload as CanonicalTemplate;
  return {
    name: template.name,
    category: template.category ?? 'GENERAL',
    language: template.language ?? 'en_US',
    body: { text: template.content ?? '' },
    _meta: { variableNames: Array.isArray(template.variables) ? template.variables : [] },
  };
}

// ── WhatsApp-style text ───────────────────────────────────────────────────────

function WaText({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/~(.*?)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br />');
  return <span dangerouslySetInnerHTML={{ __html: html }} className="whitespace-pre-wrap break-words" />;
}

// ── Preview bubble ────────────────────────────────────────────────────────────

function PreviewBubble({ canonical, vars }: { canonical: CanonicalTemplate; vars: Record<string, string> }) {
  const renderable = toRenderable(canonical, vars);
  return (
    <div className="flex flex-col items-end p-4 bg-canvas bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.025)_1px,transparent_0)] [background-size:18px_18px] rounded-2xl">
      <div className="max-w-[95%] min-w-[180px] rounded-2xl rounded-tr-sm bg-[#005C4B] text-white shadow-lg overflow-hidden">
        {renderable.media && (
          <div className="overflow-hidden">
            {renderable.media.type === 'IMAGE' && renderable.media.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={renderable.media.url} alt="" className="w-full object-cover max-h-44"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : renderable.media.type === 'VIDEO' ? (
              <div className="h-28 bg-black/40 flex items-center justify-center text-white/60 text-2xl">🎥</div>
            ) : renderable.media.type === 'DOCUMENT' ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-white/10">
                <span className="text-lg">📄</span>
                <span className="text-xs text-white/70 truncate">{renderable.media.filename ?? 'document'}</span>
              </div>
            ) : (
              <div className="h-28 bg-white/10 flex items-center justify-center text-white/40 text-2xl">🖼️</div>
            )}
          </div>
        )}
        {renderable.body.trim() && (
          <div className="px-3 pt-2.5 pb-1 text-sm"><WaText text={renderable.body} /></div>
        )}
        <div className="flex items-center justify-end gap-1 px-3 pb-1.5 pt-1">
          <span className="text-[10px] text-white/40">now</span>
          <span className="text-[10px] text-[#53BDEB]">✓✓</span>
        </div>
      </div>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export default function SendTemplateDialog({
  template, onClose, onSent,
}: {
  template: SendableTemplate;
  onClose: () => void;
  onSent: (result: { sent: number; failed: number }) => void;
}) {
  const { t } = useTranslation('templates');
  const canonical = useMemo(() => toCanonical(template), [template]);
  const varNames = useMemo(
    () => canonical._meta?.variableNames?.length ? canonical._meta.variableNames : extractVariableNames(canonical),
    [canonical],
  );
  const editableVars = varNames.filter(v => !AUTO_VARS.has(v));

  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vars, setVars] = useState<Record<string, string>>(
    () => ({ ...(canonical._meta?.previewValues ?? {}) }),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  // When a send finishes with some failures, we keep the dialog open and show a
  // grouped, friendly breakdown of WHY they failed instead of just a count.
  const [result, setResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const data = await api.get('/api/conversations');
        const list: ConversationEntry[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.conversations) ? data.conversations : [];
        if (mounted.current) setConversations(list.filter(c => c.contact?.phone));
      } catch {
        /* keep empty list */
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const filtered = conversations.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.contact?.name ?? '').toLowerCase().includes(q) || (c.contact?.phone ?? '').includes(q);
  });

  const allVisibleChecked = filtered.length > 0 && filtered.every(c => selected.has(c.id));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => {
    const visible = filtered.map(c => c.id);
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleChecked) visible.forEach(id => next.delete(id));
      else visible.forEach(id => next.add(id));
      return next;
    });
  };

  // Preview uses the first selected contact for the auto variables
  const firstSelected = conversations.find(c => selected.has(c.id));
  const previewVars: Record<string, string> = {
    ...vars,
    name: firstSelected?.contact?.name || 'Ahmed',
    first_name: (firstSelected?.contact?.name || 'Ahmed').split(/\s+/)[0],
    phone: firstSelected?.contact?.phone ? formatPhone(firstSelected.contact.phone) : '+9665xxxxxxx',
  };

  const canSend = selected.size > 0 && !sending;

  const finishWithResult = () => {
    if (result) onSent({ sent: result.sent, failed: result.failed });
    onClose();
  };

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post(`/api/templates/${template.id}/send-bulk`, {
        conversationIds: Array.from(selected),
        variables: vars,
      });
      const sent = res?.sent ?? 0;
      const failed = res?.failed ?? 0;
      if (failed > 0) {
        // Some/all failed — stay open and explain the causes.
        setResult({ sent, failed, errors: Array.isArray(res?.errors) ? res.errors : [] });
        setSending(false);
        return;
      }
      onSent({ sent, failed });
      onClose();
    } catch (err) {
      // Whole batch stopped (e.g. WhatsApp disconnected, warm-up limit) — the
      // thrown error carries any partial progress in err.data.
      setError(err);
      setSending(false);
    }
  };

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative flex flex-col w-full h-[94dvh] sm:h-auto sm:max-h-[85vh] sm:w-[min(920px,94vw)] bg-surface sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-line flex-shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <Send className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">
              {t('send.title', { defaultValue: 'Send template' })} · {template.name}
            </p>
            <p className="text-[11px] text-ink-3">
              {t('send.subtitle', { defaultValue: 'Arrives on WhatsApp exactly as previewed' })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — stacks on mobile, two panes on desktop */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-y-auto sm:overflow-hidden">

          {/* ── Recipients ── */}
          <div className="flex flex-col sm:w-[320px] sm:flex-shrink-0 sm:border-e border-line sm:overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-shrink-0">
              <Users className="h-4 w-4 text-brand" />
              <span className="text-xs font-semibold text-ink">
                {t('send.recipients', { defaultValue: 'Recipients' })}
              </span>
              {selected.size > 0 && (
                <span className="ms-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-brand-fg">
                  {selected.size}
                </span>
              )}
            </div>
            <div className="px-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('send.searchContacts', { defaultValue: 'Search contacts…' })}
                  className="field w-full ps-8 pe-3"
                />
              </div>
            </div>
            {filtered.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="mx-3 mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:text-ink-3 dark:hover:bg-white/5 transition-colors flex-shrink-0"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                  allVisibleChecked ? 'border-brand bg-brand' : 'border-gray-300 dark:border-white/30'
                }`}>
                  {allVisibleChecked && (
                    <svg viewBox="0 0 12 10" className="h-2.5 w-2.5" aria-hidden>
                      <path d="M1 5l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                {allVisibleChecked
                  ? t('send.deselectAll', { defaultValue: 'Deselect all' })
                  : t('send.selectAll', { defaultValue: 'Select all' })}
                <span className="ms-auto">{filtered.length}</span>
              </button>
            )}
            <div className="sm:flex-1 sm:overflow-y-auto max-h-[38vh] sm:max-h-none overflow-y-auto px-2 pb-2">
              {loading ? (
                <div className="space-y-1.5 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-11 rounded-xl bg-raised animate-pulse" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <MessageCircle className="h-7 w-7 text-ink-3 opacity-40" />
                  <p className="text-xs text-ink-3">
                    {t('send.noContacts', { defaultValue: 'No contacts found' })}
                  </p>
                </div>
              ) : (
                filtered.map(conv => {
                  const checked = selected.has(conv.id);
                  const name = conv.contact?.name || formatPhone(conv.contact?.phone ?? '') || 'Unknown';
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => toggle(conv.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start transition-colors ${
                        checked ? 'bg-brand/12' : 'hover:bg-raised'
                      }`}
                    >
                      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 transition-all ${
                        checked ? 'border-brand bg-brand' : 'border-gray-300 dark:border-white/30'
                      }`}>
                        {checked && (
                          <svg viewBox="0 0 12 10" className="h-2.5 w-2.5" aria-hidden>
                            <path d="M1 5l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                          </svg>
                        )}
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
                        {name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink"><bdi>{name}</bdi></span>
                        {conv.contact?.phone && (
                          <span className="block truncate text-[11px] text-ink-3"><bdi>{formatPhone(conv.contact.phone)}</bdi></span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Personalize + preview ── */}
          <div className="flex-1 sm:overflow-y-auto border-t sm:border-t-0 border-line">
            <div className="p-4 sm:p-5 space-y-4">

              {/* Variables */}
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-3 mb-2">
                  <AtSign className="h-3 w-3" />
                  {t('send.personalize', { defaultValue: 'Personalization' })}
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {varNames.filter(v => AUTO_VARS.has(v)).map(v => (
                    <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[10px] font-mono text-brand">
                      {`{{${v}}}`}
                      <span className="font-sans text-[9px] opacity-80">· {t('send.auto', { defaultValue: 'auto per contact' })}</span>
                    </span>
                  ))}
                </div>
                {editableVars.length > 0 ? (
                  <div className="space-y-2">
                    {editableVars.map(v => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-[11px] font-mono text-brand">{`{{${v}}}`}</span>
                        <input
                          value={vars[v] ?? ''}
                          onChange={e => setVars(prev => ({ ...prev, [v]: e.target.value }))}
                          placeholder={t('send.varPlaceholder', { defaultValue: 'Value for everyone…' })}
                          className="field flex-1"
                        />
                      </div>
                    ))}
                  </div>
                ) : varNames.length === 0 ? (
                  <p className="text-[11px] text-ink-4">
                    {t('send.noVariables', { defaultValue: 'This template has no variables — ready to go.' })}
                  </p>
                ) : null}
              </div>

              {/* Preview */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-3 mb-2">
                  {t('send.preview', { defaultValue: 'Preview' })}
                  {firstSelected?.contact?.name && (
                    <span className="normal-case font-normal tracking-normal"> · {firstSelected.contact.name}</span>
                  )}
                </p>
                <PreviewBubble canonical={canonical} vars={previewVars} />
              </div>

              {/* Whole batch failed to start — one clear, actionable cause. */}
              {error != null && (
                <FriendlyError error={error} compact onRetry={handleSend} />
              )}

              {/* Completed with failures — grouped, friendly "why" breakdown. */}
              {result && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5">
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${result.sent > 0 ? 'text-brand' : 'text-gray-400'}`} />
                    <p className="text-xs font-medium text-ink-2/80">
                      {t('send.resultSummary', {
                        defaultValue: 'Sent to {{sent}} · {{failed}} couldn’t be delivered',
                        sent: result.sent,
                        failed: result.failed,
                      })}
                    </p>
                  </div>
                  {result.errors.length > 0 ? (
                    groupErrors(result.errors).map((g) => (
                      <FriendlyError key={g.code} classified={g.sample} count={g.count} compact hideAction />
                    ))
                  ) : (
                    <p className="px-1 text-[11px] text-ink-3">
                      {t('send.resultNoDetail', {
                        defaultValue: 'Some recipients had no valid WhatsApp number.',
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer — sticky, above mobile safe area */}
        <div className="flex-shrink-0 border-t border-line bg-surface px-4 sm:px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {result ? (
            <button
              type="button"
              onClick={finishWithResult}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-brand-fg transition-all hover:bg-brand-strong active:scale-[0.99]"
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('send.done', { defaultValue: 'Done' })}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-brand-fg transition-all hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.99]"
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t('send.sending', { defaultValue: 'Sending…' })}</>
              ) : selected.size === 0 ? (
                <>{t('send.pickRecipients', { defaultValue: 'Select at least one recipient' })}</>
              ) : (
                <><CheckCircle2 className="h-4 w-4" /> {t('send.sendNow', { defaultValue: 'Send to {{count}} recipient(s)', count: selected.size })}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(dialog, document.body);
}
