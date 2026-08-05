'use client';

import { useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  InteractiveButtonsContent,
  InteractiveListContent,
  InteractiveCtaContent,
  InteractiveHeader,
} from '@crm/messaging-schema';
import { validateInteractive, type InteractiveContent } from '../../lib/interactive-engine';
import { cn } from '../../lib/utils';

type Tab = 'buttons' | 'list' | 'cta';

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Field primitives ──────────────────────────────────────────────────────────

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
        {children}
      </span>
      {hint && <span className="text-[10px] text-gray-400 dark:text-[#8696A0]/60">({hint})</span>}
    </div>
  );
}

function FieldInput({
  value, onChange, placeholder, maxLength, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none transition focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/20 disabled:opacity-50"
      />
      {maxLength && (
        <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 dark:text-white/20">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

function FieldTextarea({
  value, onChange, placeholder, maxLength, rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="w-full resize-none rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none transition focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/20"
      />
      {maxLength && (
        <span className="pointer-events-none absolute bottom-2.5 end-2.5 text-[10px] text-gray-400 dark:text-white/20">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  );
}

// ── Header editor ─────────────────────────────────────────────────────────────

type HeaderKind = 'none' | 'text' | 'image' | 'video' | 'document';

function getHeaderKind(header: InteractiveHeader | undefined): HeaderKind {
  if (!header) return 'none';
  if (header.type === 'text') return 'text';
  return header.media.mediaType as HeaderKind;
}

function makeMediaHeader(
  kind: 'image' | 'video' | 'document',
  url: string,
  mime?: string,
  fileName?: string,
): InteractiveHeader {
  const defaultMime =
    kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/octet-stream';
  return {
    type: 'media',
    media: {
      mediaType: kind,
      mime: mime ?? defaultMime,
      url: url || null,
      providerMediaId: null,
      fileName: fileName ?? null,
      sizeBytes: null,
      durationSec: null,
      width: null,
      height: null,
      thumbnailUrl: null,
    },
  };
}

const MEDIA_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf,.pdf,.doc,.docx,.xls,.xlsx',
};

function MediaUploader({
  kind,
  header,
  onChange,
}: {
  kind: 'image' | 'video' | 'document';
  header: InteractiveHeader | undefined;
  onChange: (h: InteractiveHeader | undefined) => void;
}) {
  const { t } = useTranslation('broadcasts');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'url'>('url');

  const mediaUrl = header?.type === 'media' ? (header.media.url ?? '') : '';
  const mediaName = header?.type === 'media' ? (header.media.fileName ?? '') : '';

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const token = window.localStorage.getItem('accessToken');
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? t('interactive.uploadFailed'));
      const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
      const url = data.url.startsWith('http') ? data.url : `${base}${data.url}`;
      onChange(makeMediaHeader(kind, url, data.mimeType, data.name));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('interactive.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['upload', 'url'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-lg border px-3 py-1 text-xs transition-colors',
              mode === m
                ? 'border-[#25D366]/40 bg-[#25D366]/10 text-[#25D366]'
                : 'border-gray-200 dark:border-white/10 text-gray-500 dark:text-[#8696A0] hover:border-gray-300 dark:hover:border-white/20',
            )}
          >
            {m === 'upload' ? t('interactive.upload') : t('interactive.uploadUrl')}
          </button>
        ))}
      </div>

      {mode === 'upload' ? (
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 py-4 transition-colors',
            uploading ? 'opacity-60' : 'hover:border-[#25D366]/40 hover:bg-[#25D366]/3',
          )}
        >
          <input
            type="file"
            accept={MEDIA_ACCEPT[kind]}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          {uploading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#25D366] border-t-transparent" />
          ) : mediaName ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-[#25D366]" />
              <span className="max-w-full truncate px-4 text-xs text-gray-900 dark:text-white">{mediaName}</span>
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 text-gray-500 dark:text-[#8696A0]" />
              <span className="text-xs text-gray-500 dark:text-[#8696A0]">{t('interactive.uploadClick', { kind })}</span>
            </>
          )}
        </label>
      ) : (
        <FieldInput
          value={mediaUrl}
          onChange={(v) => onChange(makeMediaHeader(kind, v))}
          placeholder={`https://example.com/file.${kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'pdf'}`}
        />
      )}

      {uploadError && <p className="text-[10px] text-red-400">{uploadError}</p>}
    </div>
  );
}

function HeaderEditor({
  header,
  onChange,
  supportMedia = true,
}: {
  header: InteractiveHeader | undefined;
  onChange: (h: InteractiveHeader | undefined) => void;
  supportMedia?: boolean;
}) {
  const { t } = useTranslation('broadcasts');
  const kind = getHeaderKind(header);
  const textVal = header?.type === 'text' ? header.text : '';

  type KOpt = { value: HeaderKind; label: string };
  const KINDS: KOpt[] = supportMedia
    ? [
        { value: 'none',     label: t('interactive.none') },
        { value: 'text',     label: t('interactive.text') },
        { value: 'image',    label: t('interactive.image') },
        { value: 'video',    label: t('interactive.video') },
        { value: 'document', label: t('interactive.doc') },
      ]
    : [
        { value: 'none', label: t('interactive.none') },
        { value: 'text', label: t('interactive.text') },
      ];

  const handleKindChange = (k: HeaderKind) => {
    if (k === 'none') { onChange(undefined); return; }
    if (k === 'text') { onChange({ type: 'text', text: textVal }); return; }
    const existingUrl = header?.type === 'media' ? (header.media.url ?? '') : '';
    onChange(makeMediaHeader(k as 'image' | 'video' | 'document', existingUrl));
  };

  return (
    <div className="space-y-2">
      <FieldLabel hint={t('interactive.optional')}>{t('interactive.headerLabel')}</FieldLabel>
      <div className="flex gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-1">
        {KINDS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleKindChange(value)}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
              kind === value
                ? 'bg-[#25D366] text-slate-950'
                : 'text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'text' && (
        <FieldInput
          value={textVal}
          onChange={(v) => onChange({ type: 'text', text: v })}
          placeholder={t('interactive.headerPlaceholder')}
          maxLength={60}
        />
      )}
      {(kind === 'image' || kind === 'video' || kind === 'document') && (
        <MediaUploader kind={kind} header={header} onChange={onChange} />
      )}
      {!supportMedia && (
        <p className="text-[10px] text-amber-400">{t('interactive.listHeaderNote')}</p>
      )}
    </div>
  );
}

// ── Validation panel ──────────────────────────────────────────────────────────

export function InteractiveValidationPanel({ content }: { content: InteractiveContent }) {
  const res = useMemo(() => validateInteractive(content, 'baileys'), [content]);
  if (res.issues.length === 0) return null;

  return (
    <div className="mt-4 space-y-1.5">
      {res.issues.map((issue, i) => (
        <div
          key={i}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2',
            issue.level === 'error'
              ? 'border-red-400/20 bg-red-400/8 text-red-300'
              : 'border-amber-400/20 bg-amber-400/8 text-amber-300',
          )}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <div>
            <p className="text-xs leading-snug">{issue.message}</p>
            {issue.downgrade && (
              <p className="mt-0.5 font-mono text-[10px] opacity-70">{issue.downgrade}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Quick Reply tab ───────────────────────────────────────────────────────────

function ButtonsTab({
  content,
  onChange,
}: {
  content: InteractiveButtonsContent;
  onChange: (c: InteractiveButtonsContent) => void;
}) {
  const { t } = useTranslation('broadcasts');
  const update = useCallback(
    (patch: Partial<InteractiveButtonsContent>) => onChange({ ...content, ...patch }),
    [content, onChange],
  );

  return (
    <div className="space-y-5">
      <HeaderEditor header={content.header} onChange={(h) => update({ header: h })} />

      <div>
        <FieldLabel hint={t('interactive.hintRequiredMax', { max: 1024 })}>{t('interactive.bodyLabel')}</FieldLabel>
        <FieldTextarea
          value={content.body}
          onChange={(v) => update({ body: v })}
          placeholder={t('interactive.bodyPlaceholderButtons')}
          maxLength={1024}
          rows={3}
        />
      </div>

      <div>
        <FieldLabel hint={t('interactive.hintOptionalMax', { max: 60 })}>{t('interactive.footerLabel')}</FieldLabel>
        <FieldInput
          value={content.footer ?? ''}
          onChange={(v) => update({ footer: v || undefined })}
          placeholder={t('interactive.footerPlaceholderButtons')}
          maxLength={60}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel>{t('interactive.buttonsLabel', { max: 3 })}</FieldLabel>
          {content.buttons.length < 3 && (
            <button
              type="button"
              onClick={() => update({ buttons: [...content.buttons, { id: genId(), title: '' }] })}
              className="flex items-center gap-1 text-xs text-[#25D366] transition-colors hover:text-[#1FAA5C]"
            >
              <Plus className="h-3 w-3" /> {t('interactive.addButton')}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {content.buttons.map((btn, i) => (
            <div key={btn.id} className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[10px] font-bold text-[#25D366]">
                {i + 1}
              </div>
              <FieldInput
                value={btn.title}
                onChange={(v) => {
                  const btns = [...content.buttons];
                  btns[i] = { ...btn, title: v };
                  update({ buttons: btns });
                }}
                placeholder={t('interactive.buttonPlaceholder', { max: 20 })}
                maxLength={20}
              />
              <button
                type="button"
                onClick={() => update({ buttons: content.buttons.filter((_, j) => j !== i) })}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 dark:text-[#8696A0] transition-colors hover:bg-red-400/10 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {content.buttons.length === 0 && (
            <p className="text-xs italic text-gray-500 dark:text-[#8696A0]">{t('interactive.noButtons')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── List tab ──────────────────────────────────────────────────────────────────

function ListTab({
  content,
  onChange,
}: {
  content: InteractiveListContent;
  onChange: (c: InteractiveListContent) => void;
}) {
  const { t } = useTranslation('broadcasts');
  const [openSection, setOpenSection] = useState<number | null>(0);
  const update = useCallback(
    (patch: Partial<InteractiveListContent>) => onChange({ ...content, ...patch }),
    [content, onChange],
  );

  return (
    <div className="space-y-5">
      <HeaderEditor header={content.header} onChange={(h) => update({ header: h })} supportMedia={false} />

      <div>
        <FieldLabel hint={t('interactive.required')}>{t('interactive.bodyLabel')}</FieldLabel>
        <FieldTextarea
          value={content.body}
          onChange={(v) => update({ body: v })}
          placeholder={t('interactive.bodyPlaceholderList')}
          maxLength={1024}
          rows={3}
        />
      </div>

      <div>
        <FieldLabel hint={t('interactive.optional')}>{t('interactive.footerLabel')}</FieldLabel>
        <FieldInput
          value={content.footer ?? ''}
          onChange={(v) => update({ footer: v || undefined })}
          placeholder={t('interactive.footerPlaceholderList')}
          maxLength={60}
        />
      </div>

      <div>
        <FieldLabel hint={t('interactive.hintMaxChars', { max: 20 })}>{t('interactive.listButtonLabel')}</FieldLabel>
        <FieldInput
          value={content.buttonText}
          onChange={(v) => update({ buttonText: v })}
          placeholder={t('interactive.listButtonPlaceholder')}
          maxLength={20}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel>{t('interactive.sectionsLabel', { max: 10 })}</FieldLabel>
          {content.sections.length < 10 && (
            <button
              type="button"
              onClick={() => {
                const sections = [
                  ...content.sections,
                  { title: `${t('interactive.sectionTitle')} ${content.sections.length + 1}`, rows: [] },
                ];
                onChange({ ...content, sections });
                setOpenSection(sections.length - 1);
              }}
              className="flex items-center gap-1 text-xs text-[#25D366] transition-colors hover:text-[#1FAA5C]"
            >
              <Plus className="h-3 w-3" /> {t('interactive.addSection')}
            </button>
          )}
        </div>

        {content.sections.length === 0 && (
          <p className="text-xs italic text-gray-500 dark:text-[#8696A0]">{t('interactive.noSections')}</p>
        )}

        <div className="space-y-2">
          {content.sections.map((sec, si) => (
            <div key={si} className="overflow-hidden rounded-xl border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-white/5 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setOpenSection(openSection === si ? null : si)}
                  className="flex flex-1 items-center gap-2 text-start"
                >
                  {openSection === si ? (
                    <ChevronUp className="h-3.5 w-3.5 text-gray-500 dark:text-[#8696A0]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-gray-500 dark:text-[#8696A0]" />
                  )}
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {sec.title || `${t('interactive.sectionTitle')} ${si + 1}`}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-[#8696A0]">{t('interactive.rowsCount', { count: sec.rows.length })}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...content, sections: content.sections.filter((_, i) => i !== si) })}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-500 dark:text-[#8696A0] transition-colors hover:bg-red-400/10 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {openSection === si && (
                <div className="space-y-3 border-t border-gray-200 dark:border-white/10 p-3">
                  <div>
                    <FieldLabel>{t('interactive.sectionTitle')}</FieldLabel>
                    <FieldInput
                      value={sec.title}
                      onChange={(v) => {
                        const sections = content.sections.map((s, i) => i === si ? { ...s, title: v } : s);
                        onChange({ ...content, sections });
                      }}
                      placeholder={t('interactive.sectionTitlePlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    {sec.rows.map((row, ri) => (
                      <div key={row.id} className="space-y-1.5 rounded-lg border border-gray-200 dark:border-white/10 p-2.5">
                        <div className="flex items-center gap-2">
                          <FieldInput
                            value={row.title}
                            onChange={(v) => {
                              const sections = content.sections.map((s, i) =>
                                i === si ? { ...s, rows: s.rows.map((r, j) => j === ri ? { ...r, title: v } : r) } : s,
                              );
                              onChange({ ...content, sections });
                            }}
                            placeholder={t('interactive.rowTitlePlaceholder', { max: 24 })}
                            maxLength={24}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const sections = content.sections.map((s, i) =>
                                i === si ? { ...s, rows: s.rows.filter((_, j) => j !== ri) } : s,
                              );
                              onChange({ ...content, sections });
                            }}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 dark:text-[#8696A0] transition-colors hover:bg-red-400/10 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <FieldInput
                          value={row.description ?? ''}
                          onChange={(v) => {
                            const sections = content.sections.map((s, i) =>
                              i === si ? { ...s, rows: s.rows.map((r, j) => j === ri ? { ...r, description: v } : r) } : s,
                            );
                            onChange({ ...content, sections });
                          }}
                          placeholder={t('interactive.rowDescPlaceholder', { max: 72 })}
                          maxLength={72}
                        />
                      </div>
                    ))}
                    {sec.rows.length < 10 && (
                      <button
                        type="button"
                        onClick={() => {
                          const sections = content.sections.map((s, i) =>
                            i === si ? { ...s, rows: [...s.rows, { id: genId(), title: '', description: '' }] } : s,
                          );
                          onChange({ ...content, sections });
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-200 dark:border-white/10 py-2 text-xs text-gray-500 dark:text-[#8696A0] transition-colors hover:border-[#25D366]/40 hover:text-[#25D366]"
                      >
                        <Plus className="h-3 w-3" /> {t('interactive.addRow')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── CTA tab ───────────────────────────────────────────────────────────────────

function CtaTab({
  content,
  onChange,
}: {
  content: InteractiveCtaContent;
  onChange: (c: InteractiveCtaContent) => void;
}) {
  const { t } = useTranslation('broadcasts');
  const update = useCallback(
    (patch: Partial<InteractiveCtaContent>) => onChange({ ...content, ...patch }),
    [content, onChange],
  );

  return (
    <div className="space-y-5">
      <HeaderEditor header={content.header} onChange={(h) => update({ header: h })} />

      <div>
        <FieldLabel hint={t('interactive.required')}>{t('interactive.bodyLabel')}</FieldLabel>
        <FieldTextarea
          value={content.body}
          onChange={(v) => update({ body: v })}
          placeholder={t('interactive.bodyPlaceholderCta')}
          maxLength={1024}
          rows={3}
        />
      </div>

      <div>
        <FieldLabel hint={t('interactive.optional')}>{t('interactive.footerLabel')}</FieldLabel>
        <FieldInput
          value={content.footer ?? ''}
          onChange={(v) => update({ footer: v || undefined })}
          placeholder={t('interactive.footerPlaceholderCta')}
          maxLength={60}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
        <FieldLabel>{t('interactive.ctaButtonLabel')}</FieldLabel>
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-500 dark:text-[#8696A0]">{t('interactive.ctaDisplayLabel', { max: 20 })}</p>
          <FieldInput
            value={content.cta.displayText}
            onChange={(v) => update({ cta: { ...content.cta, displayText: v } })}
            placeholder={t('interactive.ctaDisplayPlaceholder')}
            maxLength={20}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-500 dark:text-[#8696A0]">{t('interactive.ctaUrlLabel')}</p>
          <FieldInput
            value={content.cta.url}
            onChange={(v) => update({ cta: { ...content.cta, url: v } })}
            placeholder={t('interactive.ctaUrlPlaceholder')}
          />
        </div>
      </div>
    </div>
  );
}

// ── Default factories ─────────────────────────────────────────────────────────

const defaultButtons = (): InteractiveButtonsContent => ({
  kind: 'interactive_buttons',
  body: '',
  buttons: [],
});

const defaultList = (): InteractiveListContent => ({
  kind: 'interactive_list',
  body: '',
  buttonText: 'Select',
  sections: [{ title: 'Options', rows: [] }],
});

const defaultCta = (): InteractiveCtaContent => ({
  kind: 'interactive_cta',
  body: '',
  cta: { displayText: '', url: '' },
});

// ── Main export ───────────────────────────────────────────────────────────────

export interface InteractiveBuilderProps {
  onChange: (content: InteractiveContent, isValid: boolean) => void;
}

export default function InteractiveBuilder({ onChange }: InteractiveBuilderProps) {
  const { t } = useTranslation('broadcasts');
  const [tab, setTab] = useState<Tab>('buttons');
  const [buttonsContent, setButtonsContent] = useState<InteractiveButtonsContent>(defaultButtons);
  const [listContent, setListContent] = useState<InteractiveListContent>(defaultList);
  const [ctaContent, setCtaContent] = useState<InteractiveCtaContent>(defaultCta);

  const TAB_LABELS: Record<Tab, { label: string; description: string }> = {
    buttons: { label: t('interactive.tabButtons'),   description: t('interactive.tabButtonsDesc') },
    list:    { label: t('interactive.tabList'),      description: t('interactive.tabListDesc') },
    cta:     { label: t('interactive.tabCta'),       description: t('interactive.tabCtaDesc') },
  };

  const currentContent: InteractiveContent =
    tab === 'buttons' ? buttonsContent : tab === 'list' ? listContent : ctaContent;

  const notify = useCallback(
    (content: InteractiveContent) => {
      const v = validateInteractive(content, 'baileys');
      onChange(content, v.valid);
    },
    [onChange],
  );

  const handleButtonsChange = useCallback(
    (c: InteractiveButtonsContent) => { setButtonsContent(c); notify(c); },
    [notify],
  );
  const handleListChange = useCallback(
    (c: InteractiveListContent) => { setListContent(c); notify(c); },
    [notify],
  );
  const handleCtaChange = useCallback(
    (c: InteractiveCtaContent) => { setCtaContent(c); notify(c); },
    [notify],
  );

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    const content = nextTab === 'buttons' ? buttonsContent : nextTab === 'list' ? listContent : ctaContent;
    notify(content);
  };

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-1">
        {(Object.entries(TAB_LABELS) as [Tab, { label: string; description: string }][]).map(
          ([tabKey, { label, description }]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => handleTabChange(tabKey)}
              className={cn(
                'rounded-lg px-2 py-2 text-center transition-colors',
                tab === tabKey
                  ? 'bg-[#25D366] text-slate-950'
                  : 'text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white',
              )}
            >
              <p className={cn('text-xs font-semibold', tab === tabKey ? 'text-slate-950' : 'text-gray-900 dark:text-white')}>
                {label}
              </p>
              <p className={cn('mt-0.5 text-[9px]', tab === tabKey ? 'text-slate-800' : 'text-gray-500 dark:text-[#8696A0]')}>
                {description}
              </p>
            </button>
          ),
        )}
      </div>

      {/* Tab content */}
      {tab === 'buttons' && <ButtonsTab content={buttonsContent} onChange={handleButtonsChange} />}
      {tab === 'list'    && <ListTab    content={listContent}    onChange={handleListChange} />}
      {tab === 'cta'     && <CtaTab     content={ctaContent}     onChange={handleCtaChange} />}

      {/* Live validation */}
      <InteractiveValidationPanel content={currentContent} />
    </div>
  );
}

// ── Preview helper (used by BroadcastForm phone preview) ─────────────────────

export function getInteractivePreviewText(content: InteractiveContent): string {
  const body = (content as any).body ?? '';
  if (content.kind === 'interactive_buttons') {
    const btns = (content as InteractiveButtonsContent).buttons;
    if (btns.length > 0) {
      return body + '\n\n' + btns.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
    }
  }
  if (content.kind === 'interactive_list') {
    const c = content as InteractiveListContent;
    const rows = c.sections.flatMap((s) => s.rows);
    if (rows.length > 0) {
      return body + '\n\n' + rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.title}`).join('\n');
    }
  }
  if (content.kind === 'interactive_cta') {
    const c = content as InteractiveCtaContent;
    if (c.cta.displayText) return body + `\n\n→ ${c.cta.displayText}`;
  }
  return body;
}
