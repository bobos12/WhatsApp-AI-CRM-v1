'use client';

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, Save, Loader2, Check, Smartphone, AlertTriangle, CheckCircle2,
  Type, ImageIcon, Video, FileText, Upload, X, Send, Mic, Play,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { api, apiForm } from '../../../../lib/api';
import { useChatOpen } from '../../../../stores/chat-open-store';
import { useHeaderHidden } from '../../../../stores/header-hidden-store';
import { useDirection } from '../../../../hooks/useDirection';
import type { CanonicalTemplate, MessageType, MediaType, TemplateCategory } from '../../../../lib/template-engine/schema';
import { isCanonicalPayload, isLegacyPayload } from '../../../../lib/template-engine/schema';
import { toRenderable, extractVariableNames, legacyBlocksToCanonical, foldLegacyCanonical, deriveTemplateType } from '../../../../lib/template-engine/compiler';
import { ApprovalPanel, describeApproval, type ApprovalFields } from '../../../../components/templates/ApprovalStatus';
import { prepareUpload } from '@/lib/prepare-upload';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Category & language are no longer part of the builder UI — every template is
// saved as a general English template. The backend still receives valid values.
const DEFAULT_TEMPLATE: CanonicalTemplate = {
  name: '',
  category: 'GENERAL',
  language: 'en_US',
  body: { text: '' },
  _meta: { variableNames: [], previewValues: {} },
};

const COMMON_VARS = ['name', 'first_name', 'phone', 'company', 'order_id', 'date', 'amount', 'link'];

const MESSAGE_TYPES: Array<{ type: MessageType; icon: typeof Type; labelKey: string; fallback: string }> = [
  { type: 'TEXT',     icon: Type,      labelKey: 'builder.typeText',     fallback: 'Text' },
  { type: 'IMAGE',    icon: ImageIcon, labelKey: 'builder.typeImage',    fallback: 'Image' },
  { type: 'VIDEO',    icon: Video,     labelKey: 'builder.typeVideo',    fallback: 'Video' },
  { type: 'DOCUMENT', icon: FileText,  labelKey: 'builder.typeDocument', fallback: 'Document' },
  { type: 'AUDIO',    icon: Mic,       labelKey: 'builder.typeAudio',    fallback: 'Audio' },
];

// ── WhatsApp text renderer (*bold* _italic_ ~strike~) ──────────────────────────

function WaText({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/~(.*?)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br />');
  return <span dangerouslySetInnerHTML={{ __html: html }} className="whitespace-pre-wrap break-words" />;
}

// ── The green WhatsApp message bubble (shared by both previews) ─────────────────

function MessageBubble({ template, vars }: { template: CanonicalTemplate; vars: Record<string, string> }) {
  const r = toRenderable(template, vars);
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] min-w-[120px] overflow-hidden rounded-2xl rounded-tr-sm bg-[#005C4B] text-white shadow-lg">
        {r.media && (
          <div className="overflow-hidden">
            {r.media.type === 'IMAGE' && r.media.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.media.url} alt="" className="max-h-52 w-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : r.media.type === 'IMAGE' ? (
              <div className="flex h-28 items-center justify-center bg-white/10 text-white/40"><ImageIcon className="h-7 w-7" /></div>
            ) : r.media.type === 'VIDEO' ? (
              <div className="flex h-28 items-center justify-center bg-black/40 text-white/60"><Video className="h-8 w-8" /></div>
            ) : r.media.type === 'AUDIO' ? (
              <div className="flex items-center gap-2 px-3 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
                  <Play className="h-4 w-4" fill="currentColor" />
                </div>
                <div className="flex flex-1 items-center gap-[2px]">
                  {[7, 13, 18, 10, 15, 8, 14, 9, 16, 7, 12, 8, 13].map((h, i) => (
                    <span key={i} className="w-[2px] rounded-full bg-white/50" style={{ height: `${h}px` }} />
                  ))}
                </div>
                <Mic className="h-4 w-4 shrink-0 text-white/60" />
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-white/10 px-3 py-3">
                <FileText className="h-6 w-6 text-white/70" />
                <span className="truncate text-xs text-white/80">{r.media.filename || 'document.pdf'}</span>
              </div>
            )}
          </div>
        )}
        {r.body.trim() && (
          <div className="px-3 pt-2 pb-1 text-sm"><WaText text={r.body} /></div>
        )}
        <div className="flex items-center justify-end gap-1 px-3 pb-1.5 pt-1">
          <span className="text-[10px] text-white/40">now</span>
          <span className="text-[10px] text-[#53BDEB]">✓✓</span>
        </div>
      </div>
    </div>
  );
}

// ── Compact live preview (mobile) ──────────────────────────────────────────────

function CompactPreview({ template, vars }: { template: CanonicalTemplate; vars: Record<string, string> }) {
  const { t } = useTranslation('templates');
  const r = toRenderable(template, vars);
  const isEmpty = !r.body.trim() && !r.media;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-chat bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.03)_1px,transparent_0)] [background-size:16px_16px]">
      <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-[11px]">💬</div>
        <p className="flex-1 text-[11px] font-semibold text-ink">{t('builder.previewTitle', { defaultValue: 'WhatsApp Preview' })}</p>
        <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[9px] font-medium text-brand">✓ {t('builder.previewLive', { defaultValue: 'Live' })}</span>
      </div>
      <div className="min-h-[72px] p-3.5">
        {isEmpty ? (
          <p className="py-3 text-center text-xs text-ink-4">{t('builder.previewEmpty', { defaultValue: 'Start typing to see your message' })}</p>
        ) : (
          <MessageBubble template={template} vars={vars} />
        )}
      </div>
    </div>
  );
}

// ── Full WhatsApp preview panel (desktop) ──────────────────────────────────────

function WhatsAppPreview({ template, vars, onVarChange }: {
  template: CanonicalTemplate; vars: Record<string, string>; onVarChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation('templates');
  const r = toRenderable(template, vars);
  const isEmpty = !r.body.trim() && !r.media;
  const varNames = template._meta?.variableNames ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-line bg-raised px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs">💬</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white">{t('builder.previewTitle', { defaultValue: 'WhatsApp Preview' })}</p>
          <p className="text-[10px] text-white/40">{t('builder.previewExact', { defaultValue: 'Sent exactly as shown here' })}</p>
        </div>
        <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
          ✓ {t('builder.previewLive', { defaultValue: 'Live' })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-canvas bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.025)_1px,transparent_0)] p-4 [background-size:18px_18px]">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-white/20">
            <Smartphone className="h-8 w-8" />
            <p>{t('builder.previewEmpty', { defaultValue: 'Start typing to see your message' })}</p>
          </div>
        ) : (
          <MessageBubble template={template} vars={vars} />
        )}
      </div>

      {varNames.length > 0 && (
        <div className="max-h-48 flex-shrink-0 space-y-2 overflow-y-auto border-t border-line bg-surface px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-white/30">{t('builder.previewVariables', { defaultValue: 'Preview values' })}</p>
          {varNames.map(v => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-24 flex-shrink-0 font-mono text-[10px] text-brand">{`{{${v}}}`}</span>
              <input
                value={vars[v] ?? ''}
                onChange={e => onVarChange(v, e.target.value)}
                placeholder={v}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 placeholder:text-white/20 focus:border-brand/50 focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── A numbered step: the builder reads top to bottom as a short checklist ──────

function Step({ n, title, desc, done, aside, last, children }: {
  n: number; title: string; desc?: string; done?: boolean; aside?: React.ReactNode; last?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="relative flex gap-3.5 sm:gap-4">
      {/* number + connecting rail */}
      <div className="flex flex-col items-center">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-base ${
          done ? 'bg-brand text-brand-fg' : 'bg-raised text-ink-2 ring-1 ring-inset ring-line-strong'
        }`}>
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
        </span>
        {!last && <span className="mt-2 w-px flex-1 bg-line" aria-hidden="true" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-8 sm:pb-9'}`}>
        <div className="mb-3 flex items-start justify-between gap-3 pt-0.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-6 text-ink">{title}</h2>
            {desc && <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{desc}</p>}
          </div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}

// ── Main builder ──────────────────────────────────────────────────────────────

function BuilderContent() {
  const { t } = useTranslation('templates');
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const { isRTL } = useDirection();
  const setNavHidden = useChatOpen((s) => s.setOpen);
  const setHeaderHidden = useHeaderHidden((s) => s.setHidden);

  const [templateId, setTemplateId] = useState<string | null>(params.get('id'));
  const [template, setTemplate] = useState<CanonicalTemplate>(DEFAULT_TEMPLATE);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  /** WhatsApp's verdict on the saved version of this template. */
  const [approval, setApproval] = useState<ApprovalFields>({});
  const [submitting, setSubmitting] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);

  const messageType: MessageType = template.media ? template.media.type : 'TEXT';
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  // Hide the global header and bottom nav so the builder feels like a focused, native screen.
  useEffect(() => {
    setNavHidden(true);
    setHeaderHidden(true);
    return () => {
      setNavHidden(false);
      setHeaderHidden(false);
    };
  }, [setNavHidden, setHeaderHidden]);

  // ── Load existing template (once) ──────────────────────────────────────────
  useEffect(() => {
    if (!templateId || status !== 'authenticated' || loadedRef.current) return;
    loadedRef.current = true;
    api.get('/api/templates').then((templates: any[]) => {
      const found = templates.find((x: any) => x.id === templateId);
      if (!found) return;
      let canonical: CanonicalTemplate;
      if (isLegacyPayload(found.payload)) {
        canonical = legacyBlocksToCanonical(found.payload.blocks, found.name, found.payload.category ?? found.category, found.language);
      } else if (isCanonicalPayload(found.payload)) {
        canonical = foldLegacyCanonical(found.payload, { name: found.name, category: found.category, language: found.language });
      } else {
        canonical = { name: found.name, category: (found.category as TemplateCategory) ?? 'GENERAL', language: found.language ?? 'en_US', body: { text: found.content ?? '' } };
      }

      // A template saved outside this builder — from a broadcast, or before the
      // canonical payload existed — carries its attachment only in the columns.
      // Without this, opening it would show no media and re-saving would erase
      // it, which is precisely how attachments used to disappear.
      if (!canonical.media && found.mediaUrl && found.mediaType) {
        canonical.media = {
          type: found.mediaType as MediaType,
          url: found.mediaUrl,
          filename: found.mediaFilename ?? undefined,
          mimeType: found.mediaMimeType ?? undefined,
        };
      }

      canonical._meta = {
        ...canonical._meta,
        variableNames: extractVariableNames(canonical),
        previewValues: canonical._meta?.previewValues ?? {},
      };
      setTemplate(canonical);
      setPreviewVars(canonical._meta?.previewValues ?? {});
      setApproval({
        metaStatus: found.metaStatus ?? null,
        metaRejectedReason: found.metaRejectedReason ?? null,
        metaSubmittedAt: found.metaSubmittedAt ?? null,
        metaQualityScore: found.metaQualityScore ?? null,
      });
    }).catch(() => {});
  }, [templateId, status]);

  const update = useCallback((patch: Partial<CanonicalTemplate>) => {
    setTemplate(prev => {
      const next = { ...prev, ...patch };
      return { ...next, _meta: { ...next._meta, variableNames: extractVariableNames(next) } };
    });
  }, []);

  const setMessageType = (type: MessageType) => {
    if (type === 'TEXT') {
      update({ media: undefined });
    } else {
      update({ media: { type: type as MediaType, url: template.media?.url, filename: template.media?.filename } });
      setUploadError(null);
    }
  };

  const insertAtCursor = useCallback((token: string) => {
    const ta = bodyRef.current;
    if (!ta) { update({ body: { text: template.body.text + token } }); return; }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const newText = ta.value.slice(0, start) + token + ta.value.slice(end);
    update({ body: { text: newText } });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }, [template.body.text, update]);

  // ── Media upload ────────────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !template.media) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ready = await prepareUpload(file);
      const fd = new FormData();
      fd.append('file', ready);
      const res = await apiForm('/api/upload', fd);
      // S3 returns an absolute URL; only a local-storage path needs the API origin.
      const url = /^https?:\/\//i.test(res.url) ? res.url : `${API_BASE}${res.url}`;
      update({ media: { ...template.media, url, filename: ready.name } });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Save (in place) ──────────────────────────────────────────────────────────
  const handleSave = async (): Promise<string | null> => {
    if (!template.name.trim()) { setSaveError(t('builder.errNameRequired', { defaultValue: 'Give your template a name first' })); return null; }
    if (!template.body.text.trim() && !template.media?.url) {
      setSaveError(t('builder.errBodyRequired', { defaultValue: 'Write a message or attach a file first' })); return null;
    }
    setSaving(true);
    setSaveError(null);
    const varNames = extractVariableNames(template);
    const canonical: CanonicalTemplate = { ...template, _meta: { ...template._meta, variableNames: varNames, previewValues: previewVars } };
    try {
      const body = {
        name: template.name.trim(),
        content: template.body.text,
        type: deriveTemplateType(template),
        status: 'PUBLISHED',
        category: template.category,
        language: template.language,
        mediaUrl: template.media?.url ?? null,
        payload: canonical,
        variables: varNames,
      };
      let id = templateId;
      if (templateId) {
        await api.put(`/api/templates/${templateId}`, body);
      } else {
        const created = await api.post('/api/templates', body);
        if (created?.id) { id = created.id; setTemplateId(created.id); window.history.replaceState(null, '', `/templates/builder?id=${created.id}`); }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      return id;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      return null;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Save, then submit for WhatsApp review — as one action.
   *
   * Deliberately not two buttons. Meta reviews the *submitted* content, so
   * submitting without saving first would send the previously-saved wording for
   * approval while the editor shows something else. That divergence is invisible
   * and only surfaces days later as an approved template that says the wrong
   * thing, so the two steps are welded together.
   */
  const handleSubmitForApproval = async () => {
    // handleSave returns the id on both the create and update paths, so this one
    // call covers "never saved" and "saved but since edited" alike.
    const id = await handleSave();
    if (!id) return;

    setSubmitting(true);
    setSaveError(null);
    try {
      const result = await api.post(`/api/templates/${id}/submit`, {});
      setApproval({
        metaStatus: result?.metaStatus ?? 'PENDING',
        metaRejectedReason: result?.metaRejectedReason ?? null,
        metaSubmittedAt: result?.metaSubmittedAt ?? new Date().toISOString(),
        metaQualityScore: result?.metaQualityScore ?? null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not submit for approval');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestSend = async () => {
    if (!testPhone.trim()) { setTestResult({ ok: false, message: t('builder.testEnterPhone', { defaultValue: 'Enter a phone number (e.g. +1234567890).' }) }); return; }
    const id = templateId ?? await handleSave();
    if (!id) return;
    setTestSending(true);
    setTestResult(null);
    try {
      await api.post(`/api/templates/${id}/send`, { phone: testPhone.trim(), variables: previewVars });
      setTestResult({ ok: true, message: t('builder.testSent', { defaultValue: 'Sent! Check WhatsApp on that phone.' }) });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to send test' });
    } finally {
      setTestSending(false);
    }
  };

  const isMedia = messageType !== 'TEXT';
  // WhatsApp audio ships as a voice message, which carries no caption.
  const isAudio = messageType === 'AUDIO';
  const acceptFor =
    messageType === 'IMAGE' ? 'image/*'
    : messageType === 'VIDEO' ? 'video/*'
    : messageType === 'AUDIO' ? 'audio/*'
    : '*/*';
  const charCount = template.body.text.length;

  const SaveButtonInner = (
    <>
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
      {saving ? t('builder.saving') : saved ? t('builder.saved') : t('builder.save')}
    </>
  );

  const rejected = approval.metaStatus === 'REJECTED';
  const canSubmit = describeApproval(approval, t as Parameters<typeof describeApproval>[1]).canSubmit;
  const busy = saving || submitting;
  const approvalPanel = (
    <ApprovalPanel template={approval} submitting={submitting || saving} onSubmit={handleSubmitForApproval} hideSubmit />
  );
  const hasContent = isAudio
    ? Boolean(template.media?.url)
    : Boolean(template.body.text.trim()) && (!isMedia || Boolean(template.media?.url));

  // ── Editor steps (shared by mobile + desktop) ───────────────────────────────
  const editorControls = (
    <div>
      {/* 1 · Name */}
      <Step n={1} title={t('builder.steps.name.title')} desc={t('builder.steps.name.desc')} done={Boolean(template.name.trim())}>
        <input
          value={template.name}
          onChange={e => { update({ name: e.target.value }); if (saveError) setSaveError(null); }}
          placeholder={t('builder.namePlaceholder')}
          aria-label={t('builder.steps.name.title')}
          className="field h-11 w-full text-[15px]"
        />
      </Step>

      {/* 2 · Message type */}
      <Step n={2} title={t('builder.steps.type.title')} desc={t('builder.steps.type.desc')} done>
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-raised p-1">
          {MESSAGE_TYPES.map(({ type, icon: Icon, labelKey, fallback }) => {
            const active = messageType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setMessageType(type)}
                aria-pressed={active}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2.5 transition-[background-color,color,box-shadow,transform] duration-fast active:scale-[0.97] ${
                  active ? 'bg-surface text-brand shadow-soft ring-1 ring-line' : 'text-ink-3 hover:text-ink'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                <span className="w-full truncate text-center text-xs font-medium">{t(labelKey, { defaultValue: fallback })}</span>
              </button>
            );
          })}
        </div>
      </Step>

      {/* 3 · Content: attachment and/or text */}
      <Step
        n={3}
        title={t('builder.steps.content.title')}
        desc={isAudio ? undefined : t('builder.steps.content.desc')}
        done={hasContent}
        aside={!isAudio && <span className="shrink-0 pt-1 text-[11px] tabular-nums text-ink-4">{charCount}/4096</span>}
      >
        <div className="space-y-3">
          {isMedia && (
            <div>
              <input ref={fileRef} type="file" accept={acceptFor} onChange={handleFile} className="hidden" />
              {template.media?.url ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
                  {messageType === 'IMAGE' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={template.media.url} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      {messageType === 'VIDEO' ? <Video className="h-6 w-6" />
                        : messageType === 'AUDIO' ? <Mic className="h-6 w-6" />
                        : <FileText className="h-6 w-6" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{template.media.filename || t('builder.fileAttached', { defaultValue: 'File attached' })}</p>
                    <button type="button" onClick={() => fileRef.current?.click()} className="mt-0.5 text-xs font-medium text-brand hover:underline">
                      {t('builder.replaceFile', { defaultValue: 'Replace' })}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => update({ media: { type: template.media!.type } })}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface py-7 text-ink-3 transition-colors hover:border-brand/60 hover:bg-brand/[0.04] hover:text-brand disabled:opacity-60"
                >
                  {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                  <span className="text-sm font-medium">
                    {uploading ? t('builder.uploading', { defaultValue: 'Uploading…' }) : t('builder.tapToUpload', { defaultValue: 'Tap to upload' })}
                  </span>
                </button>
              )}
              {uploadError && <p className="mt-1.5 text-xs text-rose-500">{uploadError}</p>}
            </div>
          )}

          {isAudio ? (
            <p className="flex items-center gap-2 rounded-xl bg-raised px-3.5 py-3 text-[13px] text-ink-3">
              <Mic className="h-4 w-4 shrink-0" />
              {t('builder.audioHint', { defaultValue: 'Sent as a WhatsApp voice message. Audio messages cannot carry a caption.' })}
            </p>
          ) : (
            <>
              {isMedia && (
                <p className="text-xs font-medium text-ink-3">
                  {t('builder.caption', { defaultValue: 'Caption' })} · <span className="font-normal text-ink-4">{t('builder.optional')}</span>
                </p>
              )}
              <div className="overflow-hidden rounded-xl border border-line bg-surface transition-[border-color,box-shadow] duration-fast focus-within:border-brand/60 focus-within:ring-[3px] focus-within:ring-brand/10">
                <textarea
                  ref={bodyRef}
                  value={template.body.text}
                  onChange={e => update({ body: { text: e.target.value } })}
                  placeholder={isMedia
                    ? t('builder.captionPlaceholder', { defaultValue: 'Add a caption… (optional)' })
                    : t('builder.messagePlaceholder2', { defaultValue: 'Write your message… use *bold*, _italic_ and emojis 😊' })}
                  rows={6}
                  maxLength={4096}
                  aria-label={isMedia ? t('builder.caption', { defaultValue: 'Caption' }) : t('builder.message', { defaultValue: 'Message' })}
                  className="block min-h-[150px] w-full resize-y bg-transparent px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-4 focus:outline-none"
                />
              </div>

              {/* Personalisation */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 text-xs font-medium text-ink-3">{t('builder.insert', { defaultValue: 'Personalize:' })}</span>
                {COMMON_VARS.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertAtCursor(`{{${v}}}`)}
                    dir="ltr"
                    className="h-7 rounded-full border border-line bg-surface px-2.5 font-mono text-[11px] text-ink-2 transition-[background-color,border-color,color,transform] duration-fast hover:border-brand/40 hover:bg-brand/10 hover:text-brand active:scale-95"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Step>

      {/* 4 · Test send (optional) */}
      <Step
        n={4}
        title={t('builder.steps.test.title')}
        desc={t('builder.steps.test.desc')}
        done={Boolean(testResult?.ok)}
        last={rejected}
      >
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="tel"
              dir="ltr"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleTestSend(); }}
              placeholder="+966 5x xxx xxxx"
              aria-label={t('builder.testSendTitleNew', { defaultValue: 'Send a test to your own number' })}
              className="field h-11 min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={handleTestSend}
              disabled={testSending || !testPhone.trim()}
              className="btn btn-secondary h-11 shrink-0 justify-center disabled:opacity-50"
            >
              {testSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 icon-mirror" />}
              {t('builder.sendTest', { defaultValue: 'Send' })}
            </button>
          </div>
          {testResult && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
              testResult.ok ? 'bg-brand/10 text-brand' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            }`}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />}
              {testResult.message}
            </div>
          )}
        </div>
      </Step>

      {/* 5 · WhatsApp approval — the last step. A rejection moves to the top of
          the page instead, because Meta's reason dictates what to change. */}
      {!rejected && (
        <Step
          n={5}
          title={t('builder.steps.approval.title')}
          done={approval.metaStatus === 'APPROVED'}
          last
        >
          {approvalPanel}
        </Step>
      )}
    </div>
  );

  return (
    // Full-bleed: fill the padded <main> exactly (main is `relative`), so the page's
    // own top/side padding never shows above the editor. The editor scrolls internally.
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-canvas lg:flex-row">

      {/* ── Left: editor ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar — flush to the very top, no gap */}
        <header className="z-20 flex h-14 flex-shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:gap-3 sm:px-5">
          <button
            type="button"
            onClick={() => router.push('/templates')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
            aria-label={t('title')}
          >
            <BackIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-ink sm:text-base">
              {template.name.trim() || (templateId ? t('builder.editing', { defaultValue: 'Editing template' }) : t('builder.newDraft', { defaultValue: 'New template' }))}
            </h1>
            {template.name.trim() && (
              <p className="text-[11px] text-ink-4">
                {templateId ? t('builder.editing', { defaultValue: 'Editing template' }) : t('builder.newDraft', { defaultValue: 'New template' })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className={`btn hidden disabled:opacity-60 sm:inline-flex ${canSubmit ? 'btn-secondary' : 'btn-primary'}`}
          >
            {SaveButtonInner}
          </button>
          {canSubmit && (
            <button
              type="button"
              onClick={handleSubmitForApproval}
              disabled={busy}
              className="btn btn-primary hidden disabled:opacity-60 sm:inline-flex"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 icon-mirror" />}
              {submitting ? t('approval.submitting') : rejected ? t('approval.resubmit') : t('builder.submitShort')}
            </button>
          )}
        </header>

        {/* Form (scrolls). Extra bottom padding on phones for the sticky save bar. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[640px] px-4 pb-32 pt-5 sm:px-6 sm:pb-10 sm:pt-8">
            {saveError && (
              <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {saveError}
              </div>
            )}

            {rejected && <div className="mb-8">{approvalPanel}</div>}

            {editorControls}

            {/* Compact live preview — phones and tablets, after the steps */}
            <div className="mt-8 ps-[42px] sm:ps-11 lg:hidden">
              <CompactPreview template={template} vars={previewVars} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: preview (desktop only) ── */}
      <aside className="hidden w-[380px] flex-shrink-0 flex-col border-s border-line bg-surface lg:flex xl:w-[420px]">
        <WhatsAppPreview
          template={template}
          vars={previewVars}
          onVarChange={(name, value) => setPreviewVars(prev => ({ ...prev, [name]: value }))}
        />
      </aside>

      {/* ── Mobile sticky action bar: save, and send for review when allowed ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className={`btn h-12 flex-1 justify-center text-sm font-semibold active:scale-[0.98] disabled:opacity-60 ${canSubmit ? 'btn-secondary' : 'btn-primary'}`}
        >
          {SaveButtonInner}
        </button>
        {canSubmit && (
          <button
            type="button"
            onClick={handleSubmitForApproval}
            disabled={busy}
            className="btn btn-primary h-12 flex-[1.3] justify-center text-sm font-semibold active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 icon-mirror" />}
            {submitting ? t('approval.submitting') : rejected ? t('approval.resubmit') : t('builder.submitShort')}
          </button>
        )}
      </div>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={
      <div className="animate-fade-in space-y-4" role="status" aria-label="Loading builder">
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-64 w-full rounded-2xl" />
      </div>
    }>
      <BuilderContent />
    </Suspense>
  );
}
