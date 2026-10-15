'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Copy, Forward, Reply, Smile, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type {
  MessageDTO,
  RenderableBlock,
  RenderablePayload,
  Media,
  MessageStatus,
  MessageKind,
  ReplyReference,
} from '@crm/messaging-schema';

// ── Legacy compatibility adapter ──────────────────────────────────────────────
// Converts old flat Message shape (schemaVersion=0) to MessageDTO so the
// single renderer handles both old and new rows.

export interface LegacyMessage {
  id: string;
  fromMe: boolean;
  senderType?: 'agent' | 'user' | string;
  direction?: 'INBOUND' | 'OUTBOUND';
  body: string;
  type?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'INTERACTIVE';
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaCaption?: string | null;
  mediaDuration?: number | null;
  timestamp: string;
  status?: string;
  replyToId?: string | null;
  replyToBody?: string | null;
  reactions?: LegacyReaction[];
  schemaVersion?: number;
  renderable?: RenderablePayload;
  clientId?: string;
}

export interface LegacyReaction {
  id: string;
  emoji: string;
  userId?: string | null;
  contactPhone?: string | null;
  user?: { id: string; name: string } | null;
}

function deriveMediaType(type?: string, mime?: string): Media['mediaType'] {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/webp') return 'sticker';
  if (m.startsWith('image/') || type === 'IMAGE') return 'image';
  if (m.startsWith('video/') || type === 'VIDEO') return 'video';
  if (m.startsWith('audio/') || type === 'AUDIO') return 'audio';
  return 'document';
}

const GENERIC_LABELS = new Set(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']);

export function legacyToDto(msg: LegacyMessage): MessageDTO & { _reactions?: LegacyReaction[] } {
  const isOutbound = msg.senderType === 'agent' || msg.fromMe || msg.direction === 'OUTBOUND';
  const direction = isOutbound ? 'outbound' : ('inbound' as const);
  const status = ((msg.status ?? 'received').toLowerCase()) as MessageStatus;
  const reply: ReplyReference | null = msg.replyToBody
    ? { messageId: msg.replyToId ?? null, externalId: null, preview: msg.replyToBody, kind: 'text' }
    : null;

  // schemaVersion=1 messages carry a pre-computed renderable.
  // Only use it when it was built with a rich mode — fallback_text renderables
  // downgrade all media to plain text and must be rebuilt from the raw columns.
  if (msg.schemaVersion === 1 && msg.renderable) {
    const compat = (msg.renderable as RenderablePayload).compatibility;
    if (!compat || compat.mode !== 'fallback_text') {
      return {
        schemaVersion: 1,
        id: msg.id,
        clientId: msg.clientId ?? msg.id,
        externalId: null,
        provider: 'baileys',
        sessionId: '',
        conversationId: '',
        contactPhone: '',
        teamId: null,
        direction,
        content: { kind: 'text', body: msg.body ?? '', previewUrl: false },
        status,
        reply,
        timestamp: msg.timestamp,
        renderable: msg.renderable,
        meta: {
          sequenceNumber: 0,
          origin: null,
          errorReason: null,
          errorCode: null,
          compatibilityMode: 'baileys_native',
          timestamps: {},
        },
        _reactions: msg.reactions,
      } as any;
    }
    // fallback_text renderable is stale — fall through to rebuild from raw columns
  }

  // Build RenderablePayload from the raw legacy columns.
  // For media-type messages we ALWAYS push a media block regardless of whether
  // mediaUrl is set — MediaBlockView shows a graceful "unavailable" state when
  // url is null rather than showing a raw "IMAGE" / "AUDIO" text label.
  const blocks: RenderableBlock[] = [];
  const mime = msg.mediaMimeType ?? '';
  const isMediaType = Boolean(msg.type && msg.type !== 'TEXT' && msg.type !== 'INTERACTIVE');
  const isGenericBody = GENERIC_LABELS.has((msg.body ?? '').toUpperCase().trim());
  // Use mediaCaption as caption; fall back to body only when it's not a generic label
  const caption = msg.mediaCaption || (!isGenericBody && msg.body ? msg.body : undefined) || undefined;

  if (msg.replyToBody) {
    blocks.push({ type: 'reply_quote', preview: msg.replyToBody, kind: 'text' });
  }

  if (isMediaType) {
    const media: Media = {
      mediaType: deriveMediaType(msg.type, mime),
      mime: mime || 'application/octet-stream',
      url: msg.mediaUrl ?? null,
      providerMediaId: null,
      fileName: msg.mediaFileName ?? null,
      sizeBytes: null,
      durationSec: msg.mediaDuration ?? null,
      width: null,
      height: null,
      thumbnailUrl: null,
    };
    blocks.push({ type: 'media', media, caption });
    // Also show non-generic body text as additional text (e.g. caption sent separately)
    if (msg.body && !isGenericBody && !msg.mediaCaption) {
      // body IS the caption — already passed above; skip to avoid duplication
    }
  } else {
    if (msg.body) blocks.push({ type: 'body_text', text: msg.body });
  }

  if (!blocks.length) blocks.push({ type: 'body_text', text: '' });

  const kind: MessageKind = isMediaType ? 'media' : 'text';
  const renderable: RenderablePayload = {
    kind,
    blocks,
    compatibility: { mode: 'baileys_native', originalKind: kind, effectiveKind: kind, downgraded: false, downgradeReason: null, warnings: [] },
  };

  return {
    schemaVersion: 1,
    id: msg.id,
    clientId: msg.clientId ?? msg.id,
    externalId: null,
    provider: 'baileys',
    sessionId: '',
    conversationId: '',
    contactPhone: '',
    teamId: null,
    direction,
    content: { kind: 'text', body: msg.body ?? '', previewUrl: false },
    status,
    reply,
    timestamp: msg.timestamp,
    renderable,
    meta: {
      sequenceNumber: 0,
      origin: null,
      errorReason: null,
      errorCode: null,
      compatibilityMode: 'baileys_native',
      timestamps: {},
    },
    _reactions: msg.reactions,
  } as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL ?? '')
  : '';

function resolveUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
  return `${API_BASE}${url}`;
}

// Parse text and return array of text nodes and link elements
function parseTextWithLinks(text: string): (string | { type: 'link'; url: string; text: string })[] {
  const urlPattern = /https?:\/\/[^\s<>[\]{}|\\^`]+|www\.[^\s<>[\]{}|\\^`]+/g;
  const parts: (string | { type: 'link'; url: string; text: string })[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    let url = match[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    parts.push({ type: 'link', url, text: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? [text] : parts;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatClock(s: number) {
  const n = Number.isFinite(s) ? Math.max(0, s) : 0;
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
}

// ── Status ticks (§7.2 of design doc) ────────────────────────────────────────

function StatusTick({ status }: { status: MessageStatus }) {
  if (status === 'received' || status === 'processed' || !status) return null;

  if (status === 'failed') {
    return <span className="text-red-500 text-xs leading-none" title="Failed">⚠</span>;
  }
  if (status === 'queued' || status === 'sending') {
    return <span className="text-gray-400 text-xs leading-none" title="Sending">🕒</span>;
  }
  if (status === 'expired') {
    return <span className="text-red-400 text-xs leading-none" title="Expired">🕒</span>;
  }
  if (status === 'provider_accepted') {
    return (
      <svg viewBox="0 0 16 11" className="h-3 w-3 shrink-0 text-ink-4" fill="currentColor" aria-label="Sent">
        <path d="M11.071.653a.75.75 0 0 1 .025 1.06L5.196 8.1 3.12 6.079a.75.75 0 1 0-1.06 1.072L4.67 9.76a.75.75 0 0 0 1.072-.012l6.389-6.889a.75.75 0 0 0-1.061-1.206z" />
      </svg>
    );
  }
  if (status === 'server_confirmed') {
    return (
      <svg viewBox="0 0 16 11" className="h-3 w-3 shrink-0 text-ink-3" fill="currentColor" aria-label="Confirmed">
        <path d="M11.071.653a.75.75 0 0 1 .025 1.06L5.196 8.1 3.12 6.079a.75.75 0 1 0-1.06 1.072L4.67 9.76a.75.75 0 0 0 1.072-.012l6.389-6.889a.75.75 0 0 0-1.061-1.206z" />
      </svg>
    );
  }
  const isRead = status === 'read';
  const color = isRead ? '#34B7F1' : 'currentColor';
  return (
    <svg viewBox="0 0 20 11" className="h-3 w-auto shrink-0" fill={color} aria-label={isRead ? 'Read' : 'Delivered'}>
      <path d="M15.071.653a.75.75 0 0 1 .025 1.06L9.196 8.1 7.12 6.079a.75.75 0 1 0-1.06 1.072L8.67 9.76a.75.75 0 0 0 1.072-.012l6.389-6.889a.75.75 0 0 0-1.061-1.206z" />
      <path d="M11.071.653a.75.75 0 0 1 .025 1.06L5.196 8.1 3.12 6.079a.75.75 0 1 0-1.06 1.072L4.67 9.76a.75.75 0 0 0 1.072-.012l6.389-6.889a.75.75 0 0 0-1.061-1.206z" />
    </svg>
  );
}

// ── Voice note player ─────────────────────────────────────────────────────────

function VoiceNotePlayer({ src, duration, isFromMe }: { src: string; duration?: number | null; isFromMe: boolean }) {
  const { t } = useTranslation('chat');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const handlers = {
      play:            () => setPlaying(true),
      pause:           () => setPlaying(false),
      ended:           () => { setPlaying(false); setCurrent(0); },
      timeupdate:      () => setCurrent(el.currentTime || 0),
      loadedmetadata:  () => { if (Number.isFinite(el.duration)) setTotal(el.duration); },
    };
    for (const [e, fn] of Object.entries(handlers)) el.addEventListener(e, fn as EventListener);
    return () => { for (const [e, fn] of Object.entries(handlers)) el.removeEventListener(e, fn as EventListener); };
  }, []);

  const progress = total ? Math.min(100, (current / total) * 100) : 0;
  const remaining = total ? Math.max(0, total - current) : 0;

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    el.paused ? await el.play() : el.pause();
  };

  const seek = (v: number) => {
    const el = audioRef.current;
    if (!el || !total) return;
    el.currentTime = Math.min(total, Math.max(0, v));
    setCurrent(el.currentTime);
  };

  return (
    <div className="flex w-[260px] max-w-full items-center gap-2.5 py-0.5 sm:w-[300px]">
      <audio ref={audioRef} preload="metadata" className="hidden"><source src={src} /></audio>
      <button type="button" onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-transform active:scale-95"
        aria-label={playing ? t('message.pauseAudio') : t('message.playAudio')}>
        {playing
          ? <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          : <svg viewBox="0 0 24 24" className="ms-0.5 h-4 w-4 fill-current"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      {/* Force LTR: an audio scrubber always fills left→right, Arabic included. */}
      <div className="min-w-0 flex-1" dir="ltr">
        <input type="range" min={0} max={Math.max(0, total || 0)} step="0.1" value={current}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ '--vn-progress': `${progress}%` } as CSSProperties}
          className={`vn-range ${isFromMe ? 'vn-light' : 'vn-dark'}`}
          aria-label={t('message.seekAudio')} />
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-3">
          <span>{formatClock(playing || current > 0 ? current : total || 0)}</span>
          {playing && <span>-{formatClock(remaining)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Individual block renderers ─────────────────────────────────────────────────

function ReplyQuoteView({ block, isFromMe }: { block: { preview: string; kind: MessageKind }; isFromMe: boolean }) {
  return (
    <div className={`mb-1 rounded-md border-s-[3px] px-2 py-1 text-xs ${isFromMe ? 'border-brand/60 bg-black/[0.05] dark:bg-black/20' : 'border-brand bg-black/[0.04] dark:bg-white/[0.05]'}`}>
      <p className="truncate text-ink-2">{block.preview || '(message)'}</p>
    </div>
  );
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileExtension(fileName: string | null | undefined, mime: string | null | undefined): string {
  if (fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot !== -1) return fileName.slice(dot + 1).toUpperCase();
  }
  const mimeMap: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/zip': 'ZIP',
    'text/plain': 'TXT',
  };
  return (mime && mimeMap[mime]) ? mimeMap[mime] : 'FILE';
}

function FileTypeIcon({ ext, isFromMe }: { ext: string; isFromMe: boolean }) {
  const colorMap: Record<string, string> = {
    PDF: 'text-red-400', DOC: 'text-blue-400', DOCX: 'text-blue-400',
    XLS: 'text-green-400', XLSX: 'text-green-400', PPT: 'text-orange-400',
    ZIP: 'text-yellow-400', TXT: 'text-gray-400',
  };
  const color = colorMap[ext] ?? 'text-ink-3';
  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isFromMe ? 'bg-black/10 dark:bg-white/10' : 'bg-raised'}`}>
      <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-current ${color}`} aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/>
      </svg>
    </div>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation('chat');
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        aria-label={t('message.closeImage')}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <a
        href={src}
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        {t('message.downloadFile')}
      </a>
    </div>
  );
}

function MediaBlockView({ media, caption, isFromMe }: { media: Media; caption?: string; isFromMe: boolean }) {
  const { t } = useTranslation('chat');
  const src = resolveUrl(media.url) ?? undefined;
  const type = media.mediaType;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  if (type === 'sticker') {
    if (!src || imgError) {
      return (
        <div className={`flex h-40 w-40 items-center justify-center rounded-xl ${isFromMe ? 'bg-black/10' : 'bg-white/10'}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8 opacity-40 fill-current"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-1">
        <img src={src} alt={t('message.stickerMessage')} onError={() => setImgError(true)} className="max-w-[180px] rounded-xl bg-white/10 p-2 object-contain" loading="lazy" />
      </div>
    );
  }

  if (type === 'image') {
    if (!src || imgError) {
      return (
        <div className={`flex h-48 w-full items-center justify-center rounded-xl overflow-hidden ${isFromMe ? 'bg-gradient-to-br from-black/20 to-black/10' : 'bg-gradient-to-br from-gray-100 to-gray-50 dark:from-white/20 dark:to-white/10'}`}>
          <div className="flex flex-col items-center gap-2.5 text-center px-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${isFromMe ? 'bg-black/10' : 'bg-gray-200 dark:bg-white/15'}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-3" fill="currentColor" opacity="0.6"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
            </div>
            <p className="text-xs font-medium text-ink-2">{t('message.imageUnavailable')}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl">
        {lightboxOpen && <ImageLightbox src={src} alt={caption ?? ''} onClose={() => setLightboxOpen(false)} />}
        <div className="relative">
          {imageLoading && (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-white/10 dark:to-white/5 animate-pulse rounded-xl" />
          )}
          <button type="button" onClick={() => setLightboxOpen(true)} className="block w-full focus:outline-none" aria-label={t('message.viewFullImage')}>
            <img
              src={src}
              alt={caption ?? ''}
              onError={() => { setImgError(true); setImageLoading(false); }}
              onLoad={() => setImageLoading(false)}
              className="max-h-[360px] w-full rounded-xl object-cover transition-opacity hover:opacity-95 cursor-zoom-in"
              loading="lazy"
            />
          </button>
        </div>
        {caption && <p className="mt-1.5 text-sm leading-5 break-words">{caption}</p>}
      </div>
    );
  }

  if (type === 'video') {
    return (
      <div className="overflow-hidden rounded-xl">
        <video
          controls
          preload="metadata"
          className="w-full rounded-xl bg-black max-h-[360px] aspect-video"
        >
          {src && <source src={src} type={media.mime || 'video/mp4'} />}
        </video>
        {caption && <p className="mt-1.5 text-sm leading-5 break-words">{caption}</p>}
      </div>
    );
  }

  if (type === 'audio' || type === 'voice') {
    return src
      ? <VoiceNotePlayer src={src} duration={media.durationSec} isFromMe={isFromMe} />
      : (
        <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${isFromMe ? 'bg-black/10' : 'bg-raised'}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 opacity-50 fill-current"><path d="M12 3a9 9 0 0 0-9 9h2a7 7 0 0 1 7-7V3z"/></svg>
          <p className="text-xs text-ink-3">{t('message.audioUnavailable')}</p>
        </div>
      );
  }

  // ── Document card ──
  if (!src) {
    return (
      <div className={`flex items-center gap-3 rounded-xl px-3 py-3 ${isFromMe ? 'bg-black/10' : 'bg-gray-50 dark:bg-white/10'}`}>
        <FileTypeIcon ext={fileExtension(media.fileName, media.mime)} isFromMe={isFromMe} />
        <div className="min-w-0 max-w-[55vw] flex-1 sm:max-w-[240px]">
          <p className="truncate text-sm font-medium text-ink">
            {media.fileName ?? t('message.attachmentUnavailable')}
          </p>
          <p className="text-xs text-ink-3">{t('message.fileUnavailable')}</p>
        </div>
      </div>
    );
  }

  const ext = fileExtension(media.fileName, media.mime);
  const sizeLabel = formatFileSize(media.sizeBytes);

  return (
    <div className={`rounded-xl overflow-hidden ${isFromMe ? 'bg-black/10' : 'bg-gray-50 dark:bg-white/10'}`}>
      <div className="flex items-center gap-3 px-3 py-3">
        <FileTypeIcon ext={ext} isFromMe={isFromMe} />
        <div className="min-w-0 max-w-[55vw] flex-1 sm:max-w-[240px]">
          <p className="truncate text-sm font-medium text-ink">
            {media.fileName ?? `Attachment.${ext.toLowerCase()}`}
          </p>
          <p className="text-xs text-ink-3">
            {[ext, sizeLabel].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className={`flex items-center gap-1 border-t px-3 py-1.5 ${isFromMe ? 'border-black/10' : 'border-line'}`}>
        <a
          href={src}
          download={media.fileName ?? true}
          className="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:text-sky-800 dark:text-sky-300"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          {t('message.downloadFile')}
        </a>
        <div className={`h-4 w-px ${isFromMe ? 'bg-black/10' : 'bg-overlay'}`} />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:text-sky-800 dark:text-sky-300"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
          {t('message.openFile')}
        </a>
      </div>
      {caption && (
        <div className={`px-3 pb-2 pt-0 border-t ${isFromMe ? 'border-black/10' : 'border-line'}`}>
          <p className="text-xs text-ink-2 break-words">{caption}</p>
        </div>
      )}
    </div>
  );
}

function BodyTextView({ text, isFromMe, trailing }: { text: string; isFromMe: boolean; trailing?: React.ReactNode }) {
  const { t } = useTranslation('chat');
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    setExpanded(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) { setClamped(false); return; }
      setClamped(el.scrollHeight > el.clientHeight + 1);
    });
  }, [text]);

  const parts = parseTextWithLinks(text);

  return (
    <div>
      <div ref={ref} dir="auto" className={`text-[14px] leading-[1.45] break-words whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:break-word] ${expanded ? '' : 'line-clamp-[12]'}`}>
        {parts.map((part, i) => {
          if (typeof part === 'string') {
            return <span key={i}>{part}</span>;
          }
          return (
            <a
              key={i}
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 underline decoration-sky-700/30 underline-offset-2 transition-colors hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/30"
            >
              {part.text}
            </a>
          );
        })}
        {trailing}
      </div>
      {clamped && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold text-brand">
          {expanded ? t('message.showLess') : t('message.readMore')}
        </button>
      )}
    </div>
  );
}

function ButtonsView({ blocks, isFromMe }: { blocks: Array<{ type: 'reply_button' | 'url_button' | 'phone_button'; id?: string; title: string; url?: string; phoneNumber?: string; disabled?: boolean }>; isFromMe: boolean }) {
  return (
    <div className={`mt-2 divide-y border-t ${isFromMe ? 'divide-black/10 border-black/10' : 'divide-gray-200 border-gray-200 dark:divide-white/10 dark:border-white/10'}`}>
      {blocks.map((b, i) => {
        const base = `w-full py-2 px-1 text-sm font-medium text-center transition text-sky-700 hover:bg-black/[0.04] dark:text-sky-300 dark:hover:bg-white/5`;
        if (b.type === 'url_button' && b.url) {
          return (
            <a key={i} href={b.url} target="_blank" rel="noreferrer" className={`${base} flex items-center justify-center gap-1`}>
              {b.title}
              <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current opacity-60" aria-hidden><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </a>
          );
        }
        if (b.type === 'phone_button' && b.phoneNumber) {
          return (
            <a key={i} href={`tel:${b.phoneNumber}`} className={`${base} flex items-center justify-center gap-1`}>
              <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current" aria-hidden><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
              {b.title}
            </a>
          );
        }
        // reply_button
        return (
          <button key={i} type="button" disabled={b.disabled} className={`${base} ${b.disabled ? 'opacity-50 cursor-default' : ''}`}>
            {b.title}
          </button>
        );
      })}
    </div>
  );
}

function ListButtonView({ block, isFromMe }: { block: { buttonText: string; sections: any[] }; isFromMe: boolean }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`mt-2 border-t ${isFromMe ? 'border-black/10' : 'border-line'}`}>
        <button type="button" onClick={() => setOpen(true)}
          className="w-full py-2 text-sm font-medium text-center flex items-center justify-center gap-1.5 transition text-sky-700 hover:bg-black/[0.04] dark:text-sky-300 dark:hover:bg-white/5">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
          {block.buttonText}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white dark:bg-raised max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white dark:bg-raised px-4 py-3">
              <span className="font-semibold text-ink">{t('message.selectOption')}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {block.sections.map((sec: any, si: number) => (
              <div key={si}>
                {sec.title && <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-3">{sec.title}</p>}
                {(sec.rows ?? []).map((row: any, ri: number) => (
                  <button key={ri} type="button" onClick={() => setOpen(false)}
                    className="w-full px-4 py-3 text-left hover:bg-raised border-b border-line last:border-0">
                    <p className="text-sm font-medium text-ink">{row.title}</p>
                    {row.description && <p className="text-xs text-ink-3">{row.description}</p>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function NumberedOptionsView({ block, isFromMe }: { block: { intro?: string; options: Array<{ number: number; label: string }> }; isFromMe: boolean }) {
  const { t } = useTranslation('chat');
  const textColor = 'text-ink';
  const mutedColor = 'text-ink-3';
  return (
    <div className="space-y-1.5">
      {block.intro && <p className={`text-sm ${textColor}`}>{block.intro}</p>}
      <div className="space-y-0.5">
        {block.options.map((o) => (
          <p key={o.number} className={`text-sm ${textColor}`}>
            <span className="font-semibold">{o.number}.</span> {o.label}
          </p>
        ))}
      </div>
      <p className={`text-xs italic ${mutedColor}`}>{t('message.replyWithNumber')}</p>
    </div>
  );
}

function LocationView({ block }: { block: { latitude: number; longitude: number; name?: string; address?: string } }) {
  const mapsUrl = `https://maps.google.com/?q=${block.latitude},${block.longitude}`;
  return (
    <a href={mapsUrl} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-sm hover:bg-black/20 transition">
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-brand" aria-hidden><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      <div className="min-w-0">
        {block.name && <p className="font-medium truncate">{block.name}</p>}
        {block.address && <p className="text-xs opacity-70 truncate">{block.address}</p>}
        {!block.name && !block.address && <p className="text-xs opacity-70">{block.latitude.toFixed(4)}, {block.longitude.toFixed(4)}</p>}
      </div>
    </a>
  );
}

function TemplateMarkerView({ block, isFromMe }: { block: { templateName: string; language: string }; isFromMe: boolean }) {
  const { t } = useTranslation('chat');
  return (
    <div className="mb-1 flex items-center gap-1 text-xs text-ink-3">
      <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current shrink-0" aria-hidden><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
      <span className="truncate">{t('message.templateLabel', { name: block.templateName, lang: block.language })}</span>
    </div>
  );
}

// ── Block dispatcher ──────────────────────────────────────────────────────────

function BlockRenderer({ block, isFromMe, trailing }: {
  block: RenderableBlock;
  isFromMe: boolean;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation('chat');
  switch (block.type) {
    case 'reply_quote':
      return <ReplyQuoteView block={block} isFromMe={isFromMe} />;

    case 'header_text':
      return <p className="text-sm font-bold leading-snug text-ink">{block.text}</p>;

    case 'header_media':
      return <MediaBlockView media={block.media} isFromMe={isFromMe} />;

    case 'body_text':
      return <BodyTextView text={block.text} isFromMe={isFromMe} trailing={trailing} />;

    case 'media':
      return <MediaBlockView media={block.media} caption={block.caption} isFromMe={isFromMe} />;

    case 'footer':
      return <p className="text-xs text-ink-3">{block.text}</p>;

    case 'reply_button':
    case 'url_button':
    case 'phone_button':
      // Accumulate into button group — flushed by parent
      return null;

    case 'list_button':
      return <ListButtonView block={block} isFromMe={isFromMe} />;

    case 'cta_card':
      return (
        <div className={`mt-2 border-t ${isFromMe ? 'border-black/10' : 'border-line'}`}>
          <a href={block.url} target="_blank" rel="noreferrer"
            className="w-full py-2 text-sm font-medium text-center flex items-center justify-center gap-1.5 transition text-sky-700 hover:bg-black/[0.04] dark:text-sky-300 dark:hover:bg-white/5">
            {block.displayText}
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current opacity-60" aria-hidden><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
          </a>
        </div>
      );

    case 'numbered_options':
      return <NumberedOptionsView block={block} isFromMe={isFromMe} />;

    case 'location':
      return <LocationView block={block} />;

    case 'contact_card':
      return (
        <div className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-sm text-ink">
          <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0 fill-gray-400" aria-hidden><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          <div className="min-w-0">
            {block.contacts.slice(0, 2).map((c, i) => (
              <p key={i} className="truncate font-medium">{c.name.formattedName}</p>
            ))}
            {block.contacts.length > 2 && <p className="text-xs opacity-60">+{block.contacts.length - 2} more</p>}
          </div>
        </div>
      );

    case 'product_card':
      return (
        <div className="rounded-xl bg-black/10 overflow-hidden">
          {block.image && <MediaBlockView media={block.image} isFromMe={isFromMe} />}
          <div className="px-3 py-2">
            {block.title && <p className="text-sm font-medium text-ink">{block.title}</p>}
            {block.price && <p className="text-xs text-ink-3">{block.price}</p>}
          </div>
        </div>
      );

    case 'template_marker':
      return <TemplateMarkerView block={block} isFromMe={isFromMe} />;

    case 'unsupported':
      return (
        <p className="text-xs italic text-ink-3">
          {block.reason || t('message.unknownType')}
          {block.providerKind && ` (${block.providerKind})`}
        </p>
      );

    default:
      return null;
  }
}

/** Direction of the first strong character, so a bubble lays out like its text. */
function textDirection(text: string): 'rtl' | 'ltr' | undefined {
  const m = text.match(/[A-Za-zÀ-ɏ]|[֐-ࣿיִ-﷿ﹰ-﻿]/);
  if (!m) return undefined;
  return /[A-Za-zÀ-ɏ]/.test(m[0]) ? 'ltr' : 'rtl';
}

// ── Bubble footer ─────────────────────────────────────────────────────────────

function BubbleFooter({ timestamp, status, compatibility, isFromMe, overlay }: {
  timestamp: string;
  status: MessageStatus;
  compatibility: { downgraded: boolean; mode: string };
  isFromMe: boolean;
  /** Sit on top of an image/video rather than below the content. */
  overlay?: boolean;
}) {
  // Only show the downgrade badge for true fallback_text (not baileys_native, which is intentional rich rendering)
  const showDowngradeBadge = compatibility.downgraded && compatibility.mode === 'fallback_text';
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-none tabular-nums ${
        overlay ? 'rounded-full bg-black/40 px-1.5 py-1 text-white' : 'text-ink-3'
      }`}
    >
      {showDowngradeBadge && <span className="opacity-60" title="Sent as text fallback">📝</span>}
      {formatTime(timestamp)}
      {isFromMe && <StatusTick status={status} />}
    </span>
  );
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// ── Reaction pills ────────────────────────────────────────────────────────────

function ReactionPills({ grouped, isFromMe, onReact }: {
  grouped: Record<string, number>;
  isFromMe: boolean;
  onReact: (emoji: string) => void;
}) {
  const { t } = useTranslation('chat');
  if (!Object.keys(grouped).length) return null;
  return (
    <div className={`relative z-[1] -mt-1.5 flex flex-wrap gap-1 px-2 ${isFromMe ? 'justify-end' : 'justify-start'}`}>
      {Object.entries(grouped).map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          className="pop-enter flex items-center gap-0.5 rounded-full bg-surface px-1.5 py-0.5 text-xs shadow-soft ring-1 ring-line transition-transform hover:scale-105"
          title={t('message.reactWith', { emoji })}
        >
          <span>{emoji}</span>
          {count > 1 && <span className="font-semibold tabular-nums text-ink-2">{count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface MessageRendererProps {
  message: MessageDTO;
  reactions?: LegacyReaction[];
  conversationId?: string;
  onReactionUpdate?: (messageId: string, reactions: LegacyReaction[]) => void;
  onReply?: (message: MessageDTO) => void;
  onDelete?: (messageId: string) => void;
  onForward?: (message: MessageDTO) => void;
  variant?: 'chat' | 'preview';
  /** First bubble of a run from the same sender — gets the tail corner. */
  first?: boolean;
}

export function MessageRenderer({ message, reactions: reactionsProp = [], conversationId, onReactionUpdate, onReply, onDelete, onForward, variant = 'chat', first = true }: MessageRendererProps) {
  const { t } = useTranslation('chat');
  const isFromMe = message.direction === 'outbound';
  const { renderable, status, timestamp } = message;
  const blocks = renderable.blocks;

  const [reactions, setReactions] = useState<LegacyReaction[]>(reactionsProp);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Phone action sheet (rendered at the top level of the page, see below).
  const sheetRootRef = useRef<HTMLDivElement>(null);
  const sheetOpenedAt = useRef(0);
  const [isTouch, setIsTouch] = useState(false);
  // The sheet opens under the finger that held the bubble; lifting that finger
  // would otherwise "tap" whichever row slid under it (it opened Forward).
  const sheetTap = (fn: () => void) => () => {
    if (Date.now() - sheetOpenedAt.current < 450) return;
    fn();
  };
  useEffect(() => {
    const mq = window.matchMedia('(hover: none)');
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Press-and-hold opens the actions on a touch screen, as in WhatsApp. A finger
  // that moves (scrolling the chat) cancels it, so it never fires by accident.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdStart.current = null;
  };
  const touchHold = variant === 'chat' ? {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      holdStart.current = { x: e.clientX, y: e.clientY };
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        try { navigator.vibrate?.(12); } catch { /* not supported */ }
        setPickerOpen(false);
        sheetOpenedAt.current = Date.now();
        setShowMenu(true);
      }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s0 = holdStart.current;
      if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) cancelHold();
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
  } : {};

  const reactionsSig = reactionsProp.map(r => `${r.id}${r.emoji}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setReactions(reactionsProp); }, [reactionsSig]);

  useEffect(() => {
    if (!showMenu && !pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (sheetRootRef.current?.contains(e.target as Node)) return;
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowMenu(false);
        setPickerOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowMenu(false); setPickerOpen(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [showMenu, pickerOpen]);

  async function toggleReaction(emoji: string) {
    setPickerOpen(false);
    if (!conversationId || !message.id) return;
    try {
      const token = window.localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages/${message.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const updated: LegacyReaction[] = await res.json();
        setReactions(updated);
        onReactionUpdate?.(message.id, updated);
      }
    } catch { /* non-critical */ }
  }

  const messageText = blocks
    .filter(b => b.type === 'body_text' || b.type === 'header_text')
    .map(b => (b as any).text ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();

  function handleCopy() {
    if (!messageText) return;
    const fallback = (t: string) => {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(messageText).catch(() => fallback(messageText));
    } else {
      fallback(messageText);
    }
    setShowMenu(false);
  }

  const sheetItemCls = 'flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-start text-[15px] text-ink active:bg-raised';
  const menuItemCls = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink-2 transition-colors hover:bg-raised hover:text-ink text-start';

  const grouped = reactions.reduce<Record<string, number>>((acc, r) => { acc[r.emoji] = (acc[r.emoji] ?? 0) + 1; return acc; }, {});
  const bubbleTone = isFromMe ? 'bg-bubble-out text-ink' : 'bg-bubble-in text-ink';

  // Collect consecutive action buttons into a single group
  const buttonTypes = new Set<RenderableBlock['type']>(['reply_button', 'url_button', 'phone_button']);
  const segments: Array<{ kind: 'single'; block: RenderableBlock } | { kind: 'buttons'; blocks: RenderableBlock[] }> = [];
  for (const block of blocks) {
    if (buttonTypes.has(block.type)) {
      const last = segments[segments.length - 1];
      if (last?.kind === 'buttons') { last.blocks.push(block); }
      else segments.push({ kind: 'buttons', blocks: [block] });
    } else {
      segments.push({ kind: 'single', block });
    }
  }

  // WhatsApp's layout trick: when the bubble ends in text, the timestamp sits on
  // the last line if it fits (an invisible spacer reserves its width) and only
  // wraps to its own line when it doesn't — instead of always costing a line.
  const lastSeg = segments[segments.length - 1];
  const endsInText = lastSeg?.kind === 'single' && lastSeg.block.type === 'body_text' && !(status === 'failed' && isFromMe);
  const mediaOnly = segments.length === 1 && lastSeg?.kind === 'single' && lastSeg.block.type === 'media'
    && (lastSeg.block.media.mediaType === 'image' || lastSeg.block.media.mediaType === 'video') && !lastSeg.block.caption;
  const footer = <BubbleFooter timestamp={timestamp} status={status} compatibility={renderable.compatibility} isFromMe={isFromMe} overlay={mediaOnly} />;
  const spacer = <span aria-hidden="true" className={`inline-block h-3 align-baseline ${isFromMe ? 'w-[74px]' : 'w-[50px]'}`} />;

  // The bubble takes its text's direction: the inline timestamp then sits at the
  // end of the last line in Arabic and English alike. The tail corner is
  // physical (it points at the sender's side of the screen), so it is set in
  // left/right terms against the page direction, not the bubble's.
  const bubbleDir = textDirection(messageText);
  const pageRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const tailRight = isFromMe !== pageRtl;
  const tail = first ? (tailRight ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]') : '';
  const actionBtn = 'flex h-7 w-7 items-center justify-center rounded-full bg-surface text-ink-3 shadow-soft ring-1 ring-line transition-colors hover:text-ink';

  return (
    <div className={`group/msg w-full min-w-0 flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
      <div
        ref={containerRef}
        className={`relative flex min-w-0 max-w-[88%] items-center gap-1.5 sm:max-w-[70%] [@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none] ${isFromMe ? 'flex-row-reverse' : ''}`}
        onContextMenu={variant === 'chat' ? (e) => { e.preventDefault(); setShowMenu(true); setPickerOpen(false); } : undefined}
        {...touchHold}
      >
        <div className="relative min-w-0">
          {/* Quick reaction picker — floats above bubble, within bounds */}
          {pickerOpen && (
            <div className={`pop-enter absolute bottom-full z-30 mb-1.5 flex gap-0.5 rounded-full bg-surface px-1.5 py-1 shadow-pop ${isFromMe ? 'end-0' : 'start-0'}`}>
              {QUICK_REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => toggleReaction(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-raised">{e}</button>
              ))}
            </div>
          )}

          {variant === 'chat' && showMenu && !isTouch && (
            <div className={`pop-enter absolute top-7 z-30 min-w-[180px] rounded-lg bg-surface p-1 shadow-pop ${isFromMe ? 'end-0' : 'start-0'}`}>
              {conversationId && (
                <button type="button" onClick={() => { setShowMenu(false); setPickerOpen(true); }} className={menuItemCls}>
                  <Smile className="h-4 w-4 shrink-0 text-ink-3" />
                  <span>{t('message.reactMessage')}</span>
                </button>
              )}
              {onReply && (
                <button type="button" onClick={() => { setShowMenu(false); onReply(message); }} className={menuItemCls}>
                  <Reply className="h-4 w-4 shrink-0 text-ink-3" />
                  <span>{t('message.replyMessage')}</span>
                </button>
              )}
              {onForward && (
                <button type="button" onClick={() => { setShowMenu(false); onForward(message); }} className={menuItemCls}>
                  <Forward className="h-4 w-4 shrink-0 text-ink-3" />
                  <span>{t('message.forwardMessage')}</span>
                </button>
              )}
              {messageText && (
                <button type="button" onClick={handleCopy} className={menuItemCls}>
                  <Copy className="h-4 w-4 shrink-0 text-ink-3" />
                  <span>{t('message.copyMessage')}</span>
                </button>
              )}
              {isFromMe && onDelete && message.id && (
                <>
                  <div className="my-1 h-px bg-line" />
                  <button type="button" onClick={() => { setShowMenu(false); if (message.id) onDelete(message.id); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4 shrink-0" />
                    <span>{t('message.deleteMessage')}</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Bubble */}
          <div dir={bubbleDir} className={`relative w-fit max-w-full overflow-hidden rounded-lg shadow-[0_1px_0.5px_rgb(11_20_16/0.10)] ${mediaOnly ? 'p-1' : 'px-2.5 pb-1.5 pt-1.5'} ${bubbleTone} ${tail} ${segments.some(s => s.kind === 'buttons') ? 'min-w-[220px]' : ''}`}>
            {/* Menu chevron for mouse users, on hover. Touch screens use press-and-hold
                instead — a chevron on every bubble covered text and timestamps. */}
            {variant === 'chat' && (
              <button
                type="button"
                onClick={() => { setShowMenu(v => !v); setPickerOpen(false); }}
                className={`absolute end-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full text-ink-3 transition-opacity hover:text-ink [@media(hover:none)]:hidden [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100 ${isFromMe ? 'bg-bubble-out/90' : 'bg-bubble-in/90'} ${showMenu ? '!opacity-100' : ''}`}
                title={t('message.moreOptions')}
                aria-label={t('message.moreOptions')}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            )}

            <div className="space-y-1.5">
              {segments.map((seg, i) => {
                if (seg.kind === 'buttons') {
                  return <ButtonsView key={i} blocks={seg.blocks as any} isFromMe={isFromMe} />;
                }
                const isLast = i === segments.length - 1;
                return <BlockRenderer key={i} block={seg.block} isFromMe={isFromMe} trailing={isLast && endsInText ? spacer : undefined} />;
              })}
            </div>

            {status === 'failed' && isFromMe && (
              <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400">
                <span aria-hidden="true">!</span>
                <span>{t('message.failedToSend')}</span>
              </div>
            )}

            {endsInText || mediaOnly
              ? <span className={`absolute ${mediaOnly ? 'bottom-2 end-2' : 'bottom-1.5 end-2.5'}`}>{footer}</span>
              : <div className="mt-1 flex justify-end">{footer}</div>}
          </div>

          {/* Reaction pills — hang off the bottom edge, as on WhatsApp */}
          <ReactionPills grouped={grouped} isFromMe={isFromMe} onReact={toggleReaction} />
        </div>

        {/* Phone: actions as a bottom sheet, the way WhatsApp and every native
            chat app do it. The dropdown opened beneath the bubble and, for the
            newest messages, disappeared behind the composer. */}
        {variant === 'chat' && showMenu && isTouch && typeof document !== 'undefined' && createPortal(
          <div ref={sheetRootRef} className="fixed inset-0 z-[70]" role="presentation">
            <div
              className="absolute inset-0 bg-[rgb(8_12_10/0.35)] animate-fade-in"
              onClick={(e) => { e.stopPropagation(); sheetTap(() => setShowMenu(false))(); }}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-label={t('message.moreOptions')}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop animate-slide-up"
            >
              <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
              {messageText && (
                <p dir="auto" className="mx-4 mt-3 line-clamp-2 border-s-2 border-brand/60 ps-2.5 text-[13px] leading-5 text-ink-3">{messageText}</p>
              )}
              {conversationId && (
                <div className="mx-3 mt-3 flex justify-between rounded-2xl bg-raised px-2 py-1.5">
                  {QUICK_REACTIONS.map((e) => (
                    <button key={e} type="button" onClick={sheetTap(() => { setShowMenu(false); toggleReaction(e); })}
                      className="press flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none active:bg-surface"
                      aria-label={e}>{e}</button>
                  ))}
                </div>
              )}
              <div className="mt-2 px-2">
                {onReply && (
                  <button type="button" onClick={sheetTap(() => { setShowMenu(false); onReply(message); })} className={sheetItemCls}>
                    <Reply className="h-5 w-5 shrink-0 text-ink-3" /><span>{t('message.replyMessage')}</span>
                  </button>
                )}
                {onForward && (
                  <button type="button" onClick={sheetTap(() => { setShowMenu(false); onForward(message); })} className={sheetItemCls}>
                    <Forward className="h-5 w-5 shrink-0 text-ink-3" /><span>{t('message.forwardMessage')}</span>
                  </button>
                )}
                {messageText && (
                  <button type="button" onClick={sheetTap(handleCopy)} className={sheetItemCls}>
                    <Copy className="h-5 w-5 shrink-0 text-ink-3" /><span>{t('message.copyMessage')}</span>
                  </button>
                )}
                {isFromMe && onDelete && message.id && (
                  <button type="button" onClick={sheetTap(() => { setShowMenu(false); if (message.id) onDelete(message.id); })}
                    className={`${sheetItemCls} text-red-600 dark:text-red-400`}>
                    <Trash2 className="h-5 w-5 shrink-0" /><span>{t('message.deleteMessage')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

        {/* Hover actions beside the bubble: the two things people do most. */}
        {variant === 'chat' && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-fast group-hover/msg:opacity-100 max-sm:hidden">
            {conversationId && (
              <button type="button" onClick={() => { setPickerOpen(v => !v); setShowMenu(false); }} className={actionBtn} aria-label={t('message.reactMessage')} title={t('message.reactMessage')}>
                <Smile className="h-3.5 w-3.5" />
              </button>
            )}
            {onReply && (
              <button type="button" onClick={() => onReply(message)} className={actionBtn} aria-label={t('message.replyMessage')} title={t('message.replyMessage')}>
                <Reply className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Legacy wrapper — drop-in replacement for MessageBubble ────────────────────

interface LegacyMessageBubbleProps {
  message: LegacyMessage;
  conversationId?: string;
  onReactionUpdate?: (messageId: string, reactions: LegacyReaction[]) => void;
  onReply?: (message: LegacyMessage) => void;
  onDelete?: (messageId: string) => void;
  onForward?: (message: any) => void;
  first?: boolean;
}

export function LegacyMessageBubble({ message, conversationId, onReactionUpdate, onReply, onDelete, onForward, first }: LegacyMessageBubbleProps) {
  const dto = legacyToDto(message);
  return (
    <MessageRenderer
      message={dto}
      reactions={message.reactions}
      conversationId={conversationId}
      onReactionUpdate={onReactionUpdate}
      onReply={onReply ? () => onReply(message) : undefined}
      onDelete={onDelete}
      onForward={onForward ? (msg) => onForward(message) : undefined}
      first={first}
    />
  );
}

export default LegacyMessageBubble;
