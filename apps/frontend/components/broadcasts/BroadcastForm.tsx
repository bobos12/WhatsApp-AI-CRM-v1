'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Users, MessageSquare, Calendar, Send, ChevronDown, ChevronUp,
  Tag, Search, X, Check, Clock, Zap, AlertCircle, Smartphone,
  ChevronLeft, ChevronRight, Type, Image as ImageIcon, Video, FileText, Upload, Loader2,
  Mic, Square, Play, Globe, Bookmark, Paperclip, ShieldCheck,
  Moon, Gauge, FlaskConical,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, apiForm } from '../../lib/api';
import FriendlyError from '../ui/FriendlyError';
import { cn } from '../../lib/utils';
import { useTags } from '../../hooks/useTags';
import { useDirection } from '../../hooks/useDirection';
import { useAudienceMatches } from '../../hooks/useAudienceMatches';
import { useCustomFields } from '../../hooks/useCustomFields';
import AudienceFilterBuilder from '../contacts/AudienceFilterBuilder';
import { EMPTY_FILTER, type AudienceFilter } from '../../lib/audience-filter';
import { useChatOpen } from '../../stores/chat-open-store';
import { browserTimeZone, formatSchedule, nowAsWallClock, timeZoneOptions } from '../../lib/schedule';
import { usePreflight } from '../../hooks/usePreflight';
import { useWhatsAppConnection } from '../whatsapp/WhatsAppConnectProvider';
import ConnectWhatsAppModal from '../whatsapp/ConnectWhatsAppModal';
import SafetyReport from './SafetyReport';
import { PACING_LABELS, RISK_STYLES, riskLabel, type PacingProfile, type RiskFinding } from '../../lib/preflight';

/** Slowest → fastest, so a user's choice can be compared against the safe cap. */
const PACING_ORDER: PacingProfile[] = ['CAREFUL', 'BALANCED', 'STEADY'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const QUICK_EMOJI = ['😊', '👋', '🎉', '✅', '🔥', '🙏', '📦', '💳', '📅', '⭐'];

type MsgType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'VOICE';
const MESSAGE_TYPES: Array<{ type: MsgType; icon: typeof Type; labelKey: string; fallback: string }> = [
  { type: 'TEXT',     icon: Type,      labelKey: 'form.typeText',     fallback: 'Text' },
  { type: 'IMAGE',    icon: ImageIcon, labelKey: 'form.typeImage',    fallback: 'Image' },
  { type: 'VIDEO',    icon: Video,     labelKey: 'form.typeVideo',    fallback: 'Video' },
  { type: 'DOCUMENT', icon: FileText,  labelKey: 'form.typeDocument', fallback: 'Document' },
  { type: 'VOICE',    icon: Mic,       labelKey: 'form.typeVoice',    fallback: 'Voice' },
];

/** Pick an audio container the browser can actually record; WhatsApp gets ogg/opus after server transcode. */
function getPreferredAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  contactTags?: { tag: { id: string; name: string; color: string } }[];
}

interface BroadcastFormProps {
  contacts: Contact[];
  initialValues?: {
    name: string;
    message: string;
    recipients: string[];
    tag?: string;
    /** The exact wall clock the user picked, e.g. "2026-07-10T14:30". Never an instant. */
    scheduledAtLocal?: string | null;
    timezone?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaFilename?: string;
    smartSending?: boolean;
    batchSize?: number | null;
    batchIntervalMinutes?: number | null;
    pacingProfile?: string;
    quietHoursEnabled?: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
    pilotSize?: number | null;
  };
  /**
   * The campaign being edited, so pre-flight does not report the campaign as a
   * duplicate of itself.
   */
  currentBroadcastId?: string;
  submitLabel?: string;
  onBack?: () => void;
  onSave: (broadcast: BroadcastPayload) => void | Promise<void>;
}

/**
 * What the form posts. The schedule travels as a wall clock plus the zone it was
 * chosen in — never as an instant — so the server resolves it once and the value
 * that comes back is byte-for-byte what the user typed. See lib/schedule.ts.
 */
export interface BroadcastPayload {
  name: string;
  message: string;
  recipients: string[];
  tag?: string;
  scheduledAtLocal?: string;
  timezone?: string;
  interactiveContent?: object;
  mediaUrl?: string;
  mediaType?: string;
  mediaFilename?: string;
  smartSending?: boolean;
  batchSize?: number;
  batchIntervalMinutes?: number;
  pacingProfile?: PacingProfile;
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  pilotSize?: number | null;
  excludeCold?: boolean;
  excludeReceivedFrom?: string | null;
}

interface TemplateSummary {
  id: string;
  name: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
}

/**
 * The tokens the sender actually substitutes — see broadcasts/personalization.ts.
 * Anything not in that list renders as an empty string in the customer's WhatsApp,
 * which is why the old {{1}} / {{2}} chips are gone: nothing ever replaced them,
 * so they silently deleted themselves from the message.
 */
const BUILT_IN_VARIABLES = [
  { key: 'name',       labelKey: 'form.varName',      fallback: 'Full name' },
  { key: 'first_name', labelKey: 'form.varFirstName', fallback: 'First name' },
  { key: 'phone',      labelKey: 'form.varPhone',     fallback: 'Phone' },
  { key: 'email',      labelKey: 'form.varEmail',     fallback: 'Email' },
  { key: 'company',    labelKey: 'form.varCompany',   fallback: 'Company' },
];
const TOTAL_STEPS = 5;

function PhonePreview({ message, mediaType, mediaUrl, mediaFilename }: {
  message: string; mediaType?: MsgType; mediaUrl?: string; mediaFilename?: string;
}) {
  const { t } = useTranslation('broadcasts');
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hasMedia = mediaType && mediaType !== 'TEXT' && !!mediaUrl;
  const hasContent = message.trim() || hasMedia;
  return (
    <div className="mx-auto w-[210px] rounded-[28px] border-[3px] border-[#2A3942] bg-[#0B141A] p-1.5 shadow-2xl">
      <div className="mb-1 flex items-center justify-between px-2 pt-0.5 text-[8px] text-white/40">
        <span>9:41</span>
        <span className="tracking-tighter">●●●</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-t-xl bg-[#202C33] px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25D366]/20">
          <span className="text-[8px] font-bold text-[#25D366]">B</span>
        </div>
        <span className="text-[10px] font-medium text-white">{t('form.businessPreview')}</span>
      </div>
      <div className="min-h-[150px] rounded-b-xl bg-[#0B141A] p-2">
        {hasContent ? (
          <div className="max-w-[170px] overflow-hidden rounded-[6px] rounded-tl-none bg-[#202C33] shadow-sm">
            {hasMedia && (
              <div className="overflow-hidden">
                {mediaType === 'IMAGE' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl} alt="" className="max-h-24 w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : mediaType === 'VIDEO' ? (
                  <div className="flex h-20 items-center justify-center bg-black/40 text-white/60"><Video className="h-6 w-6" /></div>
                ) : mediaType === 'VOICE' ? (
                  <div className="flex items-center gap-2 px-2.5 py-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-slate-950">
                      <Play className="h-3 w-3" fill="currentColor" />
                    </div>
                    <div className="flex flex-1 items-center gap-[2px]">
                      {[6, 11, 15, 9, 13, 7, 12, 8, 14, 6, 10, 7, 11].map((h, i) => (
                        <span key={i} className="w-[2px] rounded-full bg-[#25D366]/70" style={{ height: `${h}px` }} />
                      ))}
                    </div>
                    <Mic className="h-3.5 w-3.5 shrink-0 text-[#8696A0]" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-white/5 px-2 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-white/70" />
                    <span className="truncate text-[9px] text-white/80">{mediaFilename || 'document.pdf'}</span>
                  </div>
                )}
              </div>
            )}
            <div className="p-2">
              {message.trim() && mediaType !== 'VOICE' && (
                <p className="whitespace-pre-wrap break-words text-[10px] leading-[1.5] text-white">
                  {message.length > 200 ? message.slice(0, 200) + '…' : message}
                </p>
              )}
              <div className="mt-1 flex items-center justify-end gap-1">
                <span className="text-[8px] text-[#8696A0]">{now}</span>
                <svg className="h-3 w-3 text-[#25D366]" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M17.394 5.035l-.57-.444a.434.434 0 00-.6.076L8.175 15.35l-4.306-3.396a.434.434 0 00-.6.076l-.47.595a.434.434 0 00.076.6l5.055 3.985a.434.434 0 00.6-.076l9.44-12.5a.434.434 0 00-.076-.599z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-[140px] items-center justify-center">
            <p className="text-center text-[9px] leading-relaxed text-[#8696A0]/70">
              {t('form.messagePreviewHint').split('\n').map((line, i) => (
                <span key={i}>{line}{i === 0 && <br />}</span>
              ))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  step,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  step: number;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#25D366]/30 bg-[#25D366]/10">
          <span className="text-[11px] font-bold text-[#25D366]">{step}</span>
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
            <Icon className="h-4 w-4 text-[#25D366]" />
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8696A0]">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function BroadcastForm({
  contacts,
  initialValues,
  currentBroadcastId,
  submitLabel,
  onBack,
  onSave,
}: BroadcastFormProps) {
  const { t } = useTranslation('broadcasts');
  const { isRTL: isRtl } = useDirection();
  const setNavHidden = useChatOpen((s) => s.setOpen);
  const initialRecipientSet = Array.from(new Set(initialValues?.recipients ?? []));

  // Hide BottomNav while this form is mounted (it has its own mobile action bar)
  useEffect(() => {
    setNavHidden(true);
    return () => setNavHidden(false);
  }, [setNavHidden]);

  const [formData, setFormData] = useState({
    name: initialValues?.name ?? '',
    message: initialValues?.message ?? '',
    tag: initialValues?.tag ?? '',
    // Bound verbatim to the datetime-local input; never parsed into a Date here.
    scheduledAtLocal: initialValues?.scheduledAtLocal ?? '',
    timezone: initialValues?.timezone || browserTimeZone(),
    sendNow: !initialValues?.scheduledAtLocal,
  });

  // A schedule can only ever be in the future, so the picker refuses the past.
  const minWallClock = useMemo(() => nowAsWallClock(1), []);
  const zones = useMemo(() => timeZoneOptions(), []);

  // ── Deliverability controls ────────────────────────────────────────────────
  // All three default to the protective setting. A user who wants to send faster
  // has to say so; a user who never opens this step still gets paced, quiet-hour
  // respecting delivery, which is the outcome that matters.
  const [pacingProfile, setPacingProfile] = useState<PacingProfile>(
    (initialValues?.pacingProfile as PacingProfile) ?? 'BALANCED',
  );
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(initialValues?.quietHoursEnabled ?? true);
  const [quietHoursStart, setQuietHoursStart] = useState(initialValues?.quietHoursStart ?? 21);
  const [quietHoursEnd, setQuietHoursEnd] = useState(initialValues?.quietHoursEnd ?? 9);
  const [pilotSize, setPilotSize] = useState<number | null>(initialValues?.pilotSize ?? null);
  // Audience exclusions the safety report can switch on. Server-resolved.
  const [excludeCold, setExcludeCold] = useState(false);
  const [excludeReceivedFrom, setExcludeReceivedFrom] = useState<string | null>(null);
  /** Findings whose one-tap fix has already been applied, so the button settles. */
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());

  const [selectedContacts, setSelectedContacts] = useState<string[]>(initialRecipientSet);
  const [manualPhones, setManualPhones] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  // The advanced audience filter narrows the contact picker; it is a *selection*
  // tool, not a targeting rule. Whoever it surfaces still has to be selected, and
  // what the broadcast carries is the resulting phone list — so the count shown
  // here is exactly the number of messages that will go out, even if a contact's
  // fields change between now and a scheduled send.
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>(EMPTY_FILTER);
  const {
    phones: matchedPhones,
    loading: filterLoading,
    error: filterError,
    active: filterActive,
  } = useAudienceMatches(audienceFilter);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  // Message type + media (image / video / document broadcasts)
  const [messageType, setMessageType] = useState<MsgType>(
    (initialValues?.mediaType as MsgType) || 'TEXT',
  );
  const [mediaUrl, setMediaUrl] = useState<string>(initialValues?.mediaUrl ?? '');
  const [mediaFilename, setMediaFilename] = useState<string>(initialValues?.mediaFilename ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMedia = messageType !== 'TEXT';
  const isVoice = messageType === 'VOICE';
  const acceptFor =
    messageType === 'IMAGE' ? 'image/*'
    : messageType === 'VIDEO' ? 'video/*'
    : messageType === 'VOICE' ? 'audio/*'
    : '*/*';

  // Voice-note recording (mirrors the chat composer): capture from the mic, then
  // upload the clip through the same /api/upload path the file picker uses.
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateSaveState, setTemplateSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Mobile wizard step (1-4)
  const [mobileStep, setMobileStep] = useState(1);
  // Live WhatsApp state — the send gate below reacts to it rather than checking
  // once at mount, so reconnecting re-enables the button without a reload.
  const { status: waStatus } = useWhatsAppConnection();
  const [connectOpen, setConnectOpen] = useState(false);

  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .get<TemplateSummary[]>('/api/templates')
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const normalizePhoneList = (value: string) =>
    value.split('\n').map((p) => p.trim()).filter(Boolean);

  const normalizeTag = (value: string) => value.trim().toLowerCase();

  const allTags = useTags();
  const { definitions: customFieldDefs } = useCustomFields();

  const contactHasTag = (c: Contact, tagName: string): boolean =>
    c.contactTags?.some((ct) => normalizeTag(ct.tag.name) === normalizeTag(tagName)) ?? false;

  const selectedTagSet = useMemo(() => {
    const set = new Set<string>();
    allTags.forEach((tag) => {
      const tagContacts = contacts.filter((c) => contactHasTag(c, tag.name));
      if (tagContacts.length > 0 && tagContacts.every((c) => selectedContacts.includes(c.phone))) {
        set.add(tag.name);
      }
    });
    return set;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContacts, contacts, allTags]);

  // The contact picker shows whoever survives *both* narrowings: the advanced
  // filter (evaluated server-side — `matchedPhones` is null when no filter is
  // set, which reads as "everything passes") and the free-text box on top of it.
  const filteredContacts = useMemo(() => {
    const byFilter = matchedPhones ? contacts.filter((c) => matchedPhones.has(c.phone)) : contacts;
    if (!contactSearch.trim()) return byFilter;
    const q = contactSearch.toLowerCase();
    return byFilter.filter(
      (c) => (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [contacts, contactSearch, matchedPhones]);

  const selectedSet = useMemo(() => new Set(selectedContacts), [selectedContacts]);
  const filteredPhones = useMemo(() => filteredContacts.map((c) => c.phone), [filteredContacts]);
  const allFilteredSelected =
    filteredPhones.length > 0 && filteredPhones.every((p) => selectedSet.has(p));

  const selectAllFiltered = useCallback(() => {
    setSelectedContacts((prev) => Array.from(new Set([...prev, ...filteredPhones])));
  }, [filteredPhones]);

  const deselectAllFiltered = useCallback(() => {
    const drop = new Set(filteredPhones);
    setSelectedContacts((prev) => prev.filter((p) => !drop.has(p)));
  }, [filteredPhones]);

  const resolvedAudience = useMemo(() => {
    const manualList = normalizePhoneList(manualPhones);
    const tagValue = formData.tag.trim();
    const tagMatches = tagValue ? contacts.filter((c) => contactHasTag(c, tagValue)) : [];

    const map = new Map<string, { phone: string; name: string | null; source: 'selected' | 'manual' | 'tag' }>();
    selectedContacts.forEach((phone) => {
      const c = contacts.find((x) => x.phone === phone);
      map.set(phone, { phone, name: c?.name ?? null, source: 'selected' });
    });
    manualList.forEach((phone) => {
      if (!map.has(phone)) map.set(phone, { phone, name: null, source: 'manual' });
    });
    tagMatches.forEach((c) => {
      if (!map.has(c.phone)) map.set(c.phone, { phone: c.phone, name: c.name, source: 'tag' });
    });

    return {
      count: map.size,
      selectedCount: selectedContacts.length,
      manualCount: manualList.length,
      tagCount: tagMatches.length,
      preview: Array.from(map.values()).slice(0, 6),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, formData.tag, manualPhones, selectedContacts]);

  // The broadcast must ONLY be sent by an explicit tap on the real Send button.
  // We never send via the form's onSubmit, so implicit submission — the mobile
  // keyboard "Go", an Enter keypress, or a stray enabled submit button — can
  // never fire the broadcast before the user reaches the final step.
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
    }
  };

  const submitBroadcast = async () => {
    setError(null);
    setSubmitError(null);

    if (!isValid) {
      setError(t('form.errorIncomplete', { defaultValue: 'Please complete every step before sending.' }));
      return;
    }

    const recipients = Array.from(new Set([...selectedContacts, ...normalizePhoneList(manualPhones)]));

    if (!recipients.length && !formData.tag.trim()) {
      setError(t('form.errorNoRecipients'));
      return;
    }
    if (!formData.sendNow && !formData.scheduledAtLocal) {
      setError(t('form.errorNoSchedule'));
      return;
    }
    if (!formData.sendNow && formData.scheduledAtLocal < minWallClock) {
      setError(t('form.errorPastSchedule', { defaultValue: 'That time has already passed. Pick a future time or send now.' }));
      return;
    }

    try {
      setSubmitting(true);
      await onSave({
        name: formData.name,
        message: formData.message,
        recipients,
        tag: formData.tag.trim() || undefined,
        // The wall clock goes out exactly as typed, with the zone it was typed in.
        scheduledAtLocal: formData.sendNow ? undefined : formData.scheduledAtLocal,
        timezone: formData.timezone,
        mediaUrl: isMedia ? (mediaUrl || undefined) : undefined,
        mediaType: isMedia ? messageType : undefined,
        mediaFilename: isMedia ? (mediaFilename || undefined) : undefined,
        // Batch size and interval are no longer sent — the server derives them
        // from account health so there is exactly one pacing authority.
        pacingProfile,
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        pilotSize,
        excludeCold,
        excludeReceivedFrom,
      });
    } catch (err) {
      // Surface a friendly cause instead of an unhandled rejection.
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Save the current broadcast as a reusable template — text *and* attachment.
   * The attachment is what used to be lost: only `content` was ever persisted.
   */
  const saveAsTemplate = async () => {
    const name = formData.name.trim() || t('form.untitledTemplate', { defaultValue: 'Untitled template' });
    setTemplateSaveState('saving');
    try {
      const saved = await api.post('/api/templates', {
        name,
        content: formData.message,
        status: 'PUBLISHED',
        ...(isMedia && mediaUrl
          ? { mediaUrl, mediaType: messageType === 'VOICE' ? 'AUDIO' : messageType, mediaFilename: mediaFilename || undefined }
          : {}),
      });
      setTemplates((current) => [saved, ...current]);
      setTemplateSaveState('saved');
      setTimeout(() => setTemplateSaveState('idle'), 2500);
    } catch {
      setTemplateSaveState('error');
      setTimeout(() => setTemplateSaveState('idle'), 3000);
    }
  };

  /** Restore a template into the composer — including its attachment. */
  const applyTemplate = (template: TemplateSummary) => {
    setFormData((prev) => ({ ...prev, message: template.content ?? '' }));

    if (template.mediaUrl && template.mediaType) {
      // AUDIO is stored once but surfaces as the VOICE composer, which is the
      // only audio the broadcast form knows how to record or send.
      const restored: MsgType = template.mediaType === 'AUDIO' ? 'VOICE' : (template.mediaType as MsgType);
      setMessageType(restored);
      setMediaUrl(template.mediaUrl);
      setMediaFilename(template.mediaFilename ?? '');
    } else {
      setMessageType('TEXT');
      setMediaUrl('');
      setMediaFilename('');
    }

    setShowTemplates(false);
    setTemplateSearch('');
  };

  const toggleContact = (phone: string) =>
    setSelectedContacts((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone],
    );

  const selectByTag = (tagName: string) => {
    const phones = contacts.filter((c) => contactHasTag(c, tagName)).map((c) => c.phone);
    setSelectedContacts((prev) => Array.from(new Set([...prev, ...phones])));
  };

  const deselectByTag = (tagName: string) => {
    const phones = new Set(contacts.filter((c) => contactHasTag(c, tagName)).map((c) => c.phone));
    setSelectedContacts((prev) => prev.filter((p) => !phones.has(p)));
  };

  const insertAtCursor = (token: string) => {
    const el = messageRef.current;
    if (!el) {
      setFormData((prev) => ({ ...prev, message: prev.message + token }));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = formData.message.slice(0, start) + token + formData.message.slice(end);
    setFormData((prev) => ({ ...prev, message: next }));
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + token.length;
      el.focus();
    }, 0);
  };
  const insertVariable = insertAtCursor;

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }, []);

  // Stop any in-flight recording and drop the mic stream when the form unmounts.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const uploadMediaFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiForm('/api/upload', fd);
      // Local storage returns a path ("/uploads/x.jpg"); S3 returns an absolute URL.
      // Only the former needs the API origin prepended to be loadable here.
      setMediaUrl(/^https?:\/\//i.test(res.url) ? res.url : `${API_BASE}${res.url}`);
      setMediaFilename(file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('form.uploadFailed', { defaultValue: 'Upload failed' }));
    } finally {
      setUploading(false);
    }
  };

  const changeMessageType = (type: MsgType) => {
    if (type === messageType) return;
    if (isRecording) stopRecording();
    setMessageType(type);
    setUploadError(null);
    setRecordingError(null);
    setRecordingSeconds(0);
    setMediaUrl('');
    setMediaFilename('');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadMediaFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startRecording = async () => {
    setRecordingError(null);
    setUploadError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError(t('form.audioNotSupported', { defaultValue: 'Recording is not supported on this device.' }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const mt = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mt });
        const extension = mt.includes('ogg') ? 'ogg' : mt.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: mt });
        void uploadMediaFile(file);
      };
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
      recorder.start();
    } catch {
      setRecordingError(t('form.micPermissionError', { defaultValue: 'Microphone access was denied. Check browser permissions.' }));
      setIsRecording(false);
    }
  };

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.toLowerCase();
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q));
  }, [templates, templateSearch]);

  // Every token the sender knows: the built-ins, then each custom field under its
  // own key ({{tower}}). A field added in Settings shows up here with no code change.
  const variables = useMemo(() => {
    const builtIns = BUILT_IN_VARIABLES.map((variable) => ({
      key: `{{${variable.key}}}`,
      label: t(variable.labelKey, { defaultValue: variable.fallback }),
    }));

    const custom = customFieldDefs
      .filter((definition) => definition.isActive)
      .map((definition) => ({ key: `{{${definition.key}}}`, label: definition.label }));

    return [...builtIns, ...custom];
  }, [customFieldDefs, t]);

  const charCount = formData.message.length;
  const charWarning = charCount > 1000;
  const charLimit = charCount > 4096;

  // Text broadcasts need a message; media broadcasts just need an attachment (caption optional).
  const messageReady = isMedia ? mediaUrl.trim().length > 0 : formData.message.trim().length > 0;

  const hasAudience =
    selectedContacts.length > 0 ||
    normalizePhoneList(manualPhones).length > 0 ||
    formData.tag.trim().length > 0;

  const isValid = formData.name.trim().length > 0 && messageReady && hasAudience;

  // Per-step validation for the mobile wizard. The safety step has no gate of
  // its own: it reports, it does not withhold. The only hard stop is a server
  // blocker, and that is enforced on the Send button rather than by trapping the
  // user on a step with no way forward.
  const stepValid = [
    formData.name.trim().length > 0,
    messageReady,
    hasAudience,
    formData.sendNow || (!!formData.scheduledAtLocal && formData.scheduledAtLocal >= minWallClock),
    true,
  ];

  const stepTitles = [
    t('form.nameSection'),
    t('form.messageSection'),
    t('form.audienceSection'),
    t('form.deliverySection'),
    t('safety.section', { defaultValue: 'Safety check' }),
  ];

  const previewText = formData.message;

  const BackIcon = isRtl ? ChevronRight : ChevronLeft;

  // ── Live safety analysis ───────────────────────────────────────────────────
  // The exact recipient list that would be posted, so the report describes the
  // campaign the user is about to send rather than an approximation of it.
  const draftRecipients = useMemo(
    () => Array.from(new Set([...selectedContacts, ...normalizePhoneList(manualPhones)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedContacts, manualPhones],
  );

  const { report: preflight, loading: preflightLoading, error: preflightError } = usePreflight(
    {
      message: formData.message,
      recipients: draftRecipients,
      tag: formData.tag.trim() || undefined,
      mediaUrl: isMedia ? mediaUrl || undefined : undefined,
      pacingProfile,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      pilotSize,
      excludeCold,
      excludeReceivedFrom,
    },
    { enabled: hasAudience, excludeId: currentBroadcastId },
  );

  /**
   * Apply a finding's remedy to the form.
   *
   * Each branch edits the same state the composer already owns, so the change is
   * visible where the user made the original choice — a fix that silently
   * mutated a hidden field would be indistinguishable from the system ignoring
   * them.
   */
  const applyFix = useCallback((finding: RiskFinding) => {
    const fix = finding.fix;
    if (!fix) return;
    const value = (fix.value ?? {}) as Record<string, unknown>;

    switch (fix.action) {
      case 'append_opt_out':
        setFormData((prev) =>
          prev.message.toLowerCase().includes('stop')
            ? prev
            : { ...prev, message: `${prev.message.trimEnd()}\n\n${t('safety.optOutLine', { defaultValue: 'Reply STOP to unsubscribe' })}` },
        );
        break;

      case 'add_personalization':
        setFormData((prev) =>
          prev.message.includes('{{first_name}}')
            ? prev
            : { ...prev, message: `${t('safety.greeting', { defaultValue: 'Hi {{first_name}}' })}, ${prev.message.trimStart()}` },
        );
        break;

      case 'enable_smart_sending':
        // Batching is automatic now; the safe response to "this is bigger than
        // the number should send today" is to slow the pace, which is a control
        // the user still owns.
        setPacingProfile('CAREFUL');
        break;

      case 'set_pacing':
        if (typeof value.profile === 'string') setPacingProfile(value.profile as PacingProfile);
        break;

      case 'enable_quiet_hours':
        setQuietHoursEnabled(true);
        setQuietHoursStart(21);
        setQuietHoursEnd(9);
        break;

      case 'enable_pilot':
        setPilotSize(typeof value.pilotSize === 'number' ? value.pilotSize : 50);
        break;

      // Both exclusions are server-resolved flags, not client-side filtering:
      // only the server knows which numbers are cold or already received the
      // earlier campaign, and shipping that list to the browser so it could
      // filter its own selection would be a large payload to reach a worse
      // answer. The flag travels with the draft and with the save.
      case 'drop_cold':
        setExcludeCold(true);
        break;

      case 'exclude_already_received':
        if (typeof value.excludeReceivedFrom === 'string') setExcludeReceivedFrom(value.excludeReceivedFrom);
        break;

      case 'reschedule': {
        // Tomorrow, at the hour quiet hours lift.
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(Math.max(9, quietHoursEnd), 0, 0, 0);
        const pad = (n: number) => String(n).padStart(2, '0');
        setFormData((prev) => ({
          ...prev,
          sendNow: false,
          scheduledAtLocal: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:00`,
        }));
        break;
      }

      default:
        break;
    }

    setAppliedFixes((prev) => new Set(prev).add(finding.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quietHoursEnd, t]);

  /**
   * The one hard stop in the composer: a server-side blocker. Warnings never
   * disable the button — a user who has read the report and decided to proceed
   * gets to proceed, because a system that argues past that point is one people
   * learn to click through without reading.
   */
  /**
   * The connection gate.
   *
   * Sending needs a live WhatsApp socket; scheduling does not — so this tracks
   * the *message's* state, not just the account's. A campaign set for Friday is
   * perfectly valid to save while the number is offline, and blocking it would
   * be wrong. "Send now" with nothing to send from is the case that has to stop.
   *
   * Without this the campaign starts, the sender throws "WhatsApp is not
   * connected" once per recipient, and the run reports a wall of failures for
   * messages WhatsApp never saw. The server refuses this too (409) — this is the
   * half that means the user never gets that far.
   */
  const connectionGate = useMemo(() => {
    if (!formData.sendNow || waStatus === 'connected') return null;
    return waStatus === 'connecting'
      ? {
          connecting: true,
          label: t('form.waConnecting', {
            defaultValue: 'WhatsApp is still connecting — this will be ready in a moment.',
          }),
        }
      : {
          connecting: false,
          label: t('form.waNotConnected', {
            defaultValue: 'No WhatsApp number is connected, so there is nothing to send from.',
          }),
        };
  }, [formData.sendNow, waStatus, t]);

  const blockedReason = useMemo(() => {
    // The connection outranks any safety finding: a campaign that cannot leave
    // the building has no risk profile worth arguing about.
    if (connectionGate) return connectionGate.label;
    const blocker = preflight?.findings.find((finding) => finding.kind === 'blocker');
    return blocker ? blocker.label : null;
  }, [connectionGate, preflight]);

  /** Shown above both submit bars, with the one action that resolves it. */
  const connectionNotice = connectionGate ? (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
      connectionGate.connecting
        ? 'border-amber-400/30 bg-amber-400/10'
        : 'border-[#25D366]/30 bg-[#25D366]/10',
    )}>
      <div className="flex items-start gap-2.5">
        {connectionGate.connecting
          ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" />
          : <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A] dark:text-[#25D366]" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{connectionGate.label}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8696A0]">
            {t('form.waGateHint', {
              defaultValue: 'You can still schedule this campaign for later — switch off "Send now" to save it.',
            })}
          </p>
        </div>
      </div>
      {!connectionGate.connecting && (
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="shrink-0 rounded-xl bg-[#16A34A] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#15803D] active:scale-95 dark:bg-[#25D366] dark:text-slate-950 dark:hover:bg-[#22c55e]"
        >
          {t('form.waConnectCta', { defaultValue: 'Connect WhatsApp' })}
        </button>
      )}
    </div>
  ) : null;

  // ── Template controls — available for every message type, voice notes included ──
  const templateControls = (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {templates.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2 text-xs font-medium text-gray-500 dark:text-[#8696A0] transition hover:bg-gray-100 dark:hover:bg-white/10"
          >
            {t('form.useTemplate')}
            {showTemplates ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}

        <button
          type="button"
          onClick={saveAsTemplate}
          disabled={templateSaveState === 'saving' || (!formData.message.trim() && !mediaUrl)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            templateSaveState === 'saved'
              ? 'border-[#25D366]/40 bg-[#25D366]/10 text-[#25D366]'
              : templateSaveState === 'error'
                ? 'border-red-400/40 bg-red-400/10 text-red-400'
                : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/10',
          )}
        >
          {templateSaveState === 'saving' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : templateSaveState === 'saved' ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Bookmark className="h-3.5 w-3.5" />
          )}
          {templateSaveState === 'saved'
            ? t('form.templateSaved', { defaultValue: 'Saved as template' })
            : templateSaveState === 'error'
              ? t('form.templateSaveFailed', { defaultValue: 'Could not save' })
              : t('form.saveAsTemplate', { defaultValue: 'Save as template' })}
        </button>

        {isMedia && mediaUrl && templateSaveState === 'idle' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 dark:text-[#8696A0]">
            <Paperclip className="h-3 w-3" />
            {t('form.templateIncludesMedia', { defaultValue: 'Attachment included' })}
          </span>
        )}
      </div>

      {showTemplates && templates.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-3">
          <input
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder={t('form.searchTemplates')}
            className="mb-2 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none focus:border-[#25D366]/40"
          />
          <div className="max-h-52 space-y-1.5 overflow-y-auto pe-1">
            {filteredTemplates.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-500 dark:text-[#8696A0]">{t('form.noTemplates')}</p>
            ) : (
              filteredTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="w-full rounded-lg border border-gray-100 dark:border-white/5 bg-white dark:bg-[#202C33] p-3 text-left transition hover:border-[#25D366]/30 hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-gray-900 dark:text-white">{tpl.name}</p>
                    {tpl.mediaUrl && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#25D366]/15 px-1.5 py-0.5 text-[9px] font-medium text-[#25D366]">
                        <Paperclip className="h-2.5 w-2.5" />
                        {tpl.mediaType}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500 dark:text-[#8696A0]">{tpl.content}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );

  // ── Audience section content (shared between mobile/desktop) ──
  const audienceContent = (
    <>
      {allTags.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
            {t('form.quickSelectByTag')}
          </p>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = selectedTagSet.has(tag.name);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => active ? deselectByTag(tag.name) : selectByTag(tag.name)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                    active
                      ? 'border-transparent text-white'
                      : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-[#8696A0] hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-900 dark:hover:text-white',
                  )}
                  style={active ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: active ? 'rgba(255,255,255,0.5)' : tag.color }}
                  />
                  {tag.name}
                  {tag._count !== undefined && (
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                      active ? 'bg-white/20 text-white' : 'bg-white/10 text-[#8696A0]')}>
                      {tag._count.contacts}
                    </span>
                  )}
                  {active && <Check className="h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
          {t('form.tagFilterLabel')}
        </p>
        {formData.tag ? (
          <div className="flex flex-wrap gap-2">
            {(() => {
              const found = allTags.find((x) => x.name === formData.tag);
              return (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
                  style={found ? { backgroundColor: found.color } : { backgroundColor: '#25D366' }}
                >
                  <Tag className="h-3 w-3 shrink-0" />
                  {formData.tag}
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, tag: '' })}
                    className="opacity-70 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })()}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allTags.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-[#8696A0]">{t('form.tagFilterPlaceholder')}</p>
            )}
            {allTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setFormData({ ...formData, tag: tag.name })}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-1.5 text-xs text-gray-500 dark:text-[#8696A0] hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-900 dark:hover:text-white transition-all"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
                {tag._count !== undefined && (
                  <span className="rounded-full bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:text-[#8696A0]">
                    {tag._count.contacts}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Advanced filter — the same conditions the contacts list is filtered with,
          so an audience is picked in the vocabulary the business already uses. */}
      <div className="mb-5">
        <AudienceFilterBuilder
          tone="dark"
          value={audienceFilter}
          onChange={setAudienceFilter}
          summary={
            filterActive ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-[#8696A0]">
                {filterLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="font-semibold text-[#25D366]">{matchedPhones?.size ?? 0}</span>
                )}
                {t('form.filterMatches', { defaultValue: 'match' })}
              </span>
            ) : null
          }
        />
        {filterError && (
          <p className="mt-2 text-[11px] text-red-400">{filterError}</p>
        )}
      </div>

      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
            {t('form.contactsLabel', { count: filteredContacts.length })}
            {selectedContacts.length > 0 && (
              <span className="ms-2 rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-[#25D366]">
                {t('form.selectedCount', { count: selectedContacts.length })}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            {selectedContacts.length > 0 && (
              <button type="button" onClick={() => setSelectedContacts([])} className="text-[10px] text-gray-500 dark:text-[#8696A0] transition hover:text-red-400">
                {t('form.clearAll')}
              </button>
            )}
            <button
              type="button"
              onClick={() => allFilteredSelected ? deselectAllFiltered() : selectAllFiltered()}
              disabled={filteredPhones.length === 0}
              className="text-[10px] font-medium text-[#25D366] transition hover:underline disabled:opacity-40"
            >
              {allFilteredSelected
                ? t('form.deselectResults', { count: filteredPhones.length })
                : contactSearch.trim() || filterActive
                  ? t('form.selectResults', { count: filteredPhones.length })
                  : t('form.selectAll')}
            </button>
          </div>
        </div>

        <div className="relative mb-2">
          <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 dark:text-[#8696A0]" />
          <input
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder={t('form.contactSearchPlaceholder')}
            className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] py-2.5 ps-9 pe-10 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none transition focus:border-[#25D366]/50"
          />
          {contactSearch && (
            <button type="button" onClick={() => setContactSearch('')} className="absolute end-3 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-gray-500 dark:text-[#8696A0]" />
            </button>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A]">
          {filterLoading && filteredContacts.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-8 text-center text-xs text-gray-500 dark:text-[#8696A0]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('form.filtering', { defaultValue: 'Applying filters…' })}
            </p>
          ) : filteredContacts.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500 dark:text-[#8696A0]">
              {filterActive
                ? t('form.noFilterMatches', { defaultValue: 'No contacts match these filters.' })
                : t('form.noContactsFound')}
            </p>
          ) : (
            filteredContacts.map((c) => {
              const selected = selectedContacts.includes(c.phone);
              const initials = (c.name ?? c.phone).slice(0, 2).toUpperCase();
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleContact(c.phone)}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    selected ? 'bg-[#25D366]/8' : 'hover:bg-gray-50 dark:hover:bg-white/4',
                  )}
                >
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all',
                    selected ? 'border-[#25D366] bg-[#25D366] text-slate-950' : 'border-gray-300 dark:border-white/25 bg-transparent')}>
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all',
                    selected ? 'bg-[#25D366]/20 text-[#25D366]' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-[#8696A0]')}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-xs font-medium', selected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-[#8696A0]')}>
                      {c.name ?? c.phone}
                    </p>
                    {c.name && <p className="truncate text-[10px] text-gray-400 dark:text-[#8696A0]/60">{c.phone}</p>}
                  </div>
                  {/* Desktop only, and truncated even there.
                      These were `shrink-0` with unbounded text, so two long tag
                      names pushed the name, the avatar and the checkbox off the
                      side of a phone — inside a container that only scrolls
                      vertically, which meant they were simply gone. On a 360px
                      row the contact's name is what matters; the tags are how
                      you got here. */}
                  {(c.contactTags ?? []).slice(0, 2).map(({ tag }) => (
                    <span
                      key={tag.id}
                      className="hidden max-w-[7rem] shrink truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white sm:inline-block"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
          {t('form.addManually')}
        </p>
        <textarea
          rows={3}
          value={manualPhones}
          onChange={(e) => setManualPhones(e.target.value)}
          className="w-full resize-none rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-4 py-3 font-mono text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none transition focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/20"
          placeholder={'+1234567890\n+0987654321\n+4412345678'}
          dir="ltr"
        />
        <p className="mt-1 text-[10px] text-gray-500 dark:text-[#8696A0]">{t('form.manualHint')}</p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-900 dark:text-white">{t('form.resolvedAudience')}</p>
          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold',
            resolvedAudience.count > 0
              ? 'border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]'
              : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-[#8696A0]')}>
            {resolvedAudience.count}{' '}{resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: t('form.sourceSelected'), value: resolvedAudience.selectedCount },
            { label: t('form.sourceManual'), value: resolvedAudience.manualCount },
            { label: t('form.sourceTag'), value: resolvedAudience.tagCount },
          ].map(({ label, value }) => (
            <div key={label} className="min-w-0 rounded-lg bg-gray-50 dark:bg-white/5 p-2.5 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
              {/* `tracking-wider` on a translated label is what turns three even
                  columns into one that overflows. Let it wrap instead. */}
              <p className="text-[9px] uppercase leading-tight tracking-wide text-gray-500 dark:text-[#8696A0] break-words">{label}</p>
            </div>
          ))}
        </div>
        {resolvedAudience.preview.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {resolvedAudience.preview.map((r) => (
              <span key={r.phone} className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2.5 py-1 text-[10px] text-gray-900 dark:text-white">
                <span className="truncate">{r.name ?? r.phone}</span>
                <span className="shrink-0 text-gray-500 dark:text-[#8696A0]">· {r.source}</span>
              </span>
            ))}
            {resolvedAudience.count > resolvedAudience.preview.length && (
              <span className="inline-flex items-center rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2.5 py-1 text-[10px] text-gray-500 dark:text-[#8696A0]">
                {t('form.moreRecipients', { count: resolvedAudience.count - resolvedAudience.preview.length })}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );


  // ── Delivery section content ──
  const deliveryContent = (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setFormData({ ...formData, sendNow: true })}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
            formData.sendNow ? 'border-[#25D366]/40 bg-[#25D366]/10' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] hover:border-gray-300 dark:hover:border-white/20',
          )}
        >
          <Zap className={cn('mt-0.5 h-5 w-5 shrink-0', formData.sendNow ? 'text-[#25D366]' : 'text-gray-500 dark:text-[#8696A0]')} />
          <div className="flex-1">
            <p className={cn('text-sm font-semibold', formData.sendNow ? 'text-[#25D366]' : 'text-gray-900 dark:text-white')}>
              {t('form.sendNowOption')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8696A0]">{t('form.sendNowDesc')}</p>
          </div>
          {formData.sendNow && <Check className="h-4 w-4 shrink-0 text-[#25D366]" />}
        </button>

        <button
          type="button"
          onClick={() => setFormData({ ...formData, sendNow: false })}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
            !formData.sendNow ? 'border-[#25D366]/40 bg-[#25D366]/10' : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] hover:border-gray-300 dark:hover:border-white/20',
          )}
        >
          <Clock className={cn('mt-0.5 h-5 w-5 shrink-0', !formData.sendNow ? 'text-[#25D366]' : 'text-gray-500 dark:text-[#8696A0]')} />
          <div className="flex-1">
            <p className={cn('text-sm font-semibold', !formData.sendNow ? 'text-[#25D366]' : 'text-gray-900 dark:text-white')}>
              {t('form.scheduleOption')}
            </p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8696A0]">{t('form.scheduleDesc')}</p>
          </div>
          {!formData.sendNow && <Check className="h-4 w-4 shrink-0 text-[#25D366]" />}
        </button>
      </div>

      {!formData.sendNow && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#8696A0]">{t('form.scheduleTime')}</p>
              <input
                type="datetime-local"
                value={formData.scheduledAtLocal}
                min={minWallClock}
                onChange={(e) => setFormData({ ...formData, scheduledAtLocal: e.target.value })}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/20 [color-scheme:dark]"
              />
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-[#8696A0]">
                <Globe className="h-3.5 w-3.5" />
                {t('form.timezone', { defaultValue: 'Time zone' })}
              </p>
              <select
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/20"
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Echo back exactly what will be stored, so there is no doubt left. */}
          {formData.scheduledAtLocal && (
            <div className="flex items-start gap-2 rounded-xl border border-[#25D366]/20 bg-[#25D366]/5 px-3 py-2.5">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#25D366]" />
              <p className="text-xs text-gray-500 dark:text-[#8696A0]">
                {t('form.willSendAt', { defaultValue: 'Sends at' })}{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatSchedule(formData.scheduledAtLocal, formData.timezone)}
                </span>
              </p>
            </div>
          )}

          {formData.scheduledAtLocal && formData.scheduledAtLocal < minWallClock && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t('form.errorPastSchedule', { defaultValue: 'That time has already passed. Pick a future time or send now.' })}
            </p>
          )}
        </div>
      )}

      {/* Pacing used to live here as "Smart Sending" — a toggle and two numbers
          the user typed. It now belongs entirely to the Safety step, which
          derives batch size and interval from the account's real health instead
          of a guess. Two controls that both meant "slow down", in different
          units on different steps, was how people misconfigured the very thing
          protecting them. See safetyContent below. */}

      {/* Mini summary on step 4 mobile */}
      {resolvedAudience.count > 0 && (
        <div className="mt-4 rounded-xl border border-[#25D366]/20 bg-[#25D366]/8 px-4 py-3 sm:hidden">
          <p className="text-center text-2xl font-bold text-[#25D366]">{resolvedAudience.count}</p>
          <p className="text-center text-xs text-gray-500 dark:text-[#8696A0]">
            {resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')} {t('form.recipientsReady')}
          </p>
        </div>
      )}
    </>
  );

  // ── Safety step content ──
  // Three controls and the report. The controls come first because they are what
  // the report's fixes change — a user who taps "use the slowest speed" should
  // see the switch move, not just a button turn green.
  const safetyContent = (
    <div className="space-y-4">
      {/* ── The one pacing control ──
          This replaced "Smart Sending" (a toggle plus two hand-typed numbers on
          the Delivery step). Everything that used to be manual — batch size,
          wait between batches, gap between messages — is now derived from this
          choice and the number's health, so there is a single place to look and
          a single thing to understand. */}
      <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
        <div className="mb-1 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[#25D366]" />
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">
            {t('safety.pacing', { defaultValue: 'Sending speed' })}
          </p>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
          {t('safety.pacingIntro', {
            defaultValue: 'We pick the safest speed your number can handle. You can always go slower.',
          })}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PACING_LABELS) as PacingProfile[]).map((profile) => {
            const active = pacingProfile === profile;
            const recommended = preflight?.recommended.pacingProfile === profile;
            // Anything faster than the recommendation is not merely discouraged —
            // the server clamps it. Saying so up front is better than silently
            // ignoring the click and leaving the user believing they set it.
            const capped = preflight != null
              && PACING_ORDER.indexOf(profile) > PACING_ORDER.indexOf(preflight.recommended.pacingProfile);
            return (
              <button
                key={profile}
                type="button"
                onClick={() => setPacingProfile(profile)}
                disabled={capped}
                className={cn(
                  'rounded-xl border p-3 text-start transition-all',
                  capped
                    ? 'cursor-not-allowed border-gray-100 dark:border-white/5 bg-[#202C33]/40 opacity-60'
                    : active
                      ? 'border-[#25D366]/40 bg-[#25D366]/10'
                      : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] hover:border-gray-300 dark:hover:border-white/20',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-xs font-semibold', active ? 'text-[#25D366]' : 'text-gray-900 dark:text-white')}>
                    {t(`safety.pacing_${profile}`, { defaultValue: PACING_LABELS[profile].name })}
                  </span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#25D366]" />}
                </div>
                {recommended && !active && (
                  <span className="mt-1 inline-block rounded-full bg-[#25D366]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#25D366]">
                    {t('safety.recommended', { defaultValue: 'Recommended' })}
                  </span>
                )}
                <p className="mt-1 text-[10px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
                  {t(`safety.pacingBlurb_${profile}`, { defaultValue: PACING_LABELS[profile].blurb })}
                </p>
                <p className="mt-1.5 text-[10px] tabular-nums text-gray-400 dark:text-[#8696A0]/70">{PACING_LABELS[profile].rate}</p>
                {capped && (
                  <p className="mt-1.5 text-[10px] text-amber-300/90">
                    {t('safety.pacingCapped', {
                      defaultValue: 'Not available until your number has a longer track record.',
                    })}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* The plan this choice produces, so "automatic" doesn't mean "opaque". */}
        {preflight && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-gray-100 dark:border-white/5 pt-3 text-[11px] sm:grid-cols-4">
            {[
              { label: t('safety.planRate', { defaultValue: 'Speed' }), value: `${preflight.simulation.ratePerHour}/hr` },
              { label: t('safety.planPerDay', { defaultValue: 'Per day' }), value: preflight.simulation.messagesPerDay.toLocaleString() },
              { label: t('safety.planBatch', { defaultValue: 'Batch size' }), value: preflight.recommended.smartSending ? preflight.recommended.batchSize.toLocaleString() : t('safety.planOneGo', { defaultValue: 'One run' }) },
              { label: t('safety.planFinish', { defaultValue: 'Finishes in' }), value: preflight.simulation.summary.replace('about ', '') },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <dt className="text-gray-500 dark:text-[#8696A0]">{row.label}</dt>
                <dd className="font-medium tabular-nums text-gray-700 dark:text-white/85">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* Quiet hours */}
      <div className={cn(
        'rounded-xl border p-4 transition-colors',
        quietHoursEnabled ? 'border-[#25D366]/30 bg-[#25D366]/[0.06]' : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A]',
      )}>
        <button
          type="button"
          onClick={() => setQuietHoursEnabled((v) => !v)}
          aria-pressed={quietHoursEnabled}
          className="flex w-full items-center gap-3 text-start"
        >
          <span className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            quietHoursEnabled ? 'bg-[#25D366]/15 text-[#25D366]' : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-[#8696A0]',
          )}>
            <Moon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">
              {t('safety.quietHours', { defaultValue: 'Respect quiet hours' })}
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
              {t('safety.quietHoursHint', {
                defaultValue: 'Nobody is messaged during their local night. Recipients in other countries are handled on their own clock.',
              })}
            </span>
          </span>
          <span className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors',
            quietHoursEnabled ? 'bg-[#25D366]' : 'bg-gray-300 dark:bg-white/15',
          )}>
            <span className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
              quietHoursEnabled ? 'start-[1.375rem]' : 'start-0.5',
            )} />
          </span>
        </button>

        {quietHoursEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-white/5 pt-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-gray-500 dark:text-[#8696A0]">
                {t('safety.quietFrom', { defaultValue: 'Pause from' })}
              </span>
              <select
                value={quietHoursStart}
                onChange={(e) => setQuietHoursStart(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-[#25D366]/50"
              >
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-gray-500 dark:text-[#8696A0]">
                {t('safety.quietUntil', { defaultValue: 'Resume at' })}
              </span>
              <select
                value={quietHoursEnd}
                onChange={(e) => setQuietHoursEnd(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-3 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-[#25D366]/50"
              >
                {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Pilot batch */}
      <div className={cn(
        'rounded-xl border p-4 transition-colors',
        pilotSize ? 'border-[#25D366]/30 bg-[#25D366]/[0.06]' : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A]',
      )}>
        <button
          type="button"
          onClick={() => setPilotSize((current) => (current ? null : Math.min(50, Math.max(10, Math.round(resolvedAudience.count * 0.05)))))}
          aria-pressed={Boolean(pilotSize)}
          className="flex w-full items-center gap-3 text-start"
        >
          <span className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            pilotSize ? 'bg-[#25D366]/15 text-[#25D366]' : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-[#8696A0]',
          )}>
            <FlaskConical className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">
              {t('safety.pilot', { defaultValue: 'Test on a small group first' })}
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
              {t('safety.pilotHint', {
                defaultValue: 'Send to your most engaged contacts, then pause so you can see the replies before the rest goes out.',
              })}
            </span>
          </span>
          <span className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors',
            pilotSize ? 'bg-[#25D366]' : 'bg-gray-300 dark:bg-white/15',
          )}>
            <span className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
              pilotSize ? 'start-[1.375rem]' : 'start-0.5',
            )} />
          </span>
        </button>

        {pilotSize != null && (
          <div className="mt-3 flex items-center gap-3 border-t border-gray-100 dark:border-white/5 pt-3">
            <input
              type="range"
              min={5}
              max={Math.max(10, Math.min(500, resolvedAudience.count || 100))}
              value={pilotSize}
              onChange={(e) => setPilotSize(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gray-100 dark:bg-white/10 accent-[#25D366]"
            />
            <span className="w-20 shrink-0 text-end text-xs tabular-nums text-gray-900 dark:text-white">
              {pilotSize} {t('safety.pilotContacts', { defaultValue: 'contacts' })}
            </span>
          </div>
        )}
      </div>

      {/* The report */}
      <SafetyReport
        report={preflight}
        loading={preflightLoading}
        error={preflightError}
        onApplyFix={applyFix}
        appliedFixes={appliedFixes}
      />
    </div>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={handleFormKeyDown} className="relative pb-24 sm:pb-0">

      {/* ── Mobile wizard header ── */}
      <div className="sm:hidden mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={mobileStep === 1 ? onBack : () => setMobileStep((s) => s - 1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white transition hover:bg-gray-100 dark:hover:bg-white/10"
          >
            <BackIcon className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{stepTitles[mobileStep - 1]}</span>
              <span className="shrink-0 text-[11px] text-gray-500 dark:text-[#8696A0]">{mobileStep}/{TOTAL_STEPS}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-white/10">
              <div
                className="h-1 rounded-full bg-[#25D366] transition-all duration-300"
                style={{ width: `${(mobileStep / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        {/* ── Left: form sections ── */}
        <div className="space-y-4">

          {/* 1 · Campaign name */}
          <div className={mobileStep === 1 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={1} icon={Tag} title={t('form.nameSection')} subtitle={t('form.nameSubtitle')}>
              <div className="relative">
                <Tag className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#25D366]" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-2xl border-2 border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] py-4 ps-12 pe-4 text-base font-semibold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0]/70 outline-none transition focus:border-[#25D366]/60 focus:ring-2 focus:ring-[#25D366]/20"
                  placeholder={t('form.namePlaceholder2')}
                />
              </div>
              <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-[#8696A0]">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-[#8696A0]/70" />
                {t('form.nameHelper', { defaultValue: 'Only you see this — it helps you find the broadcast later. Recipients never see it.' })}
              </p>
            </SectionCard>
          </div>

          {/* 2 · Message */}
          <div className={mobileStep === 2 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={2} icon={MessageSquare} title={t('form.messageSection')} subtitle={t('form.messageSubtitle')}>
                  {/* Message type — segmented control */}
                  <div className="mb-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
                      {t('form.messageType', { defaultValue: 'Message type' })}
                    </p>
                    <div className="grid grid-cols-5 gap-1 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-1.5">
                      {MESSAGE_TYPES.map(({ type, icon: Icon, labelKey, fallback }) => {
                        const active = messageType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => changeMessageType(type)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-2.5 transition-all',
                              active ? 'bg-white dark:bg-[#202C33] text-[#25D366] shadow-sm' : 'text-gray-500 dark:text-[#8696A0] hover:text-gray-900 dark:hover:text-white',
                            )}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                            <span className="text-[10px] font-medium">{t(labelKey, { defaultValue: fallback })}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Shared hidden file picker — used by voice upload and image/video/document */}
                  {isMedia && (
                    <input ref={fileInputRef} type="file" accept={acceptFor} onChange={handleFile} className="hidden" />
                  )}

                  {/* Voice note — record from the mic or upload an audio clip */}
                  {isVoice && (
                    <div className="mb-4">
                      {mediaUrl && !isRecording ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]">
                            <Mic className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{t('form.voiceNoteReady', { defaultValue: 'Voice note ready' })}</p>
                            <p className="truncate text-xs text-gray-500 dark:text-[#8696A0]">{mediaFilename || 'voice-note'}</p>
                          </div>
                          <button type="button" onClick={startRecording} className="text-xs font-medium text-[#25D366] hover:underline">
                            {t('form.reRecord', { defaultValue: 'Re-record' })}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setMediaUrl(''); setMediaFilename(''); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 dark:text-[#8696A0] transition hover:bg-red-500/10 hover:text-red-400"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : isRecording ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-5">
                          <span className="relative flex h-3 w-3 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                          </span>
                          <span className="voice-rec-wave inline-flex h-6 items-end gap-[3px] text-red-400">
                            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="w-[3px] rounded-full bg-current" />)}
                          </span>
                          <span dir="ltr" className="font-mono text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{formatDuration(recordingSeconds)}</span>
                          <button
                            type="button"
                            onClick={stopRecording}
                            className="ms-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600 active:scale-95"
                            aria-label={t('form.stopRecording', { defaultValue: 'Stop recording' })}
                          >
                            <Square className="h-5 w-5" fill="currentColor" />
                          </button>
                        </div>
                      ) : uploading ? (
                        <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 dark:border-white/15 bg-gray-50 dark:bg-[#0B141A] py-8 text-gray-500 dark:text-[#8696A0]">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="text-sm font-medium">{t('form.uploading', { defaultValue: 'Uploading…' })}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/15 bg-gray-50 dark:bg-[#0B141A] py-7">
                          <button
                            type="button"
                            onClick={startRecording}
                            className="flex h-16 w-16 items-center justify-center rounded-full bg-[#25D366] text-slate-950 shadow-lg transition hover:bg-[#25D366]/90 active:scale-95"
                            aria-label={t('form.tapToRecord', { defaultValue: 'Tap to record' })}
                          >
                            <Mic className="h-7 w-7" />
                          </button>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{t('form.tapToRecord', { defaultValue: 'Tap to record a voice note' })}</p>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-medium text-[#25D366] hover:underline">
                            {t('form.orUploadAudio', { defaultValue: 'or upload an audio file' })}
                          </button>
                        </div>
                      )}
                      {(uploadError || recordingError) && <p className="mt-1.5 text-xs text-red-400">{uploadError || recordingError}</p>}
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-[#8696A0]">
                        <Mic className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-[#8696A0]/70" />
                        {t('form.voiceHint', { defaultValue: 'Sent as a WhatsApp voice message. No caption.' })}
                      </p>
                    </div>
                  )}

                  {/* Media upload (image / video / document) */}
                  {isMedia && !isVoice && (
                    <div className="mb-4">
                      {mediaUrl ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-3">
                          {messageType === 'IMAGE' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#25D366]">
                              {messageType === 'VIDEO' ? <Video className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{mediaFilename || t('form.fileAttached', { defaultValue: 'File attached' })}</p>
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-[#25D366] hover:underline">
                              {t('form.replaceFile', { defaultValue: 'Replace' })}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setMediaUrl(''); setMediaFilename(''); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 dark:text-[#8696A0] transition hover:bg-red-500/10 hover:text-red-400"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/15 bg-gray-50 dark:bg-[#0B141A] py-8 text-gray-500 dark:text-[#8696A0] transition hover:border-[#25D366]/50 hover:text-[#25D366] disabled:opacity-60"
                        >
                          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                          <span className="text-sm font-medium">
                            {uploading ? t('form.uploading', { defaultValue: 'Uploading…' }) : t('form.tapToUpload', { defaultValue: 'Tap to upload' })}
                          </span>
                        </button>
                      )}
                      {uploadError && <p className="mt-1.5 text-xs text-red-400">{uploadError}</p>}
                    </div>
                  )}

                  {/* Templates apply to every message type, voice notes included. */}
                  {templateControls}

                  {/* Caption composer — hidden for voice notes (WhatsApp audio has no caption) */}
                  {!isVoice && (
                  <>
                  {/* Personalization variables */}
                  <div className="mb-2.5">
                    <p className="mb-1.5 text-[10px] text-gray-500 dark:text-[#8696A0]">{t('form.insertVariable')}</p>
                    <div className="flex flex-wrap gap-2">
                      {variables.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => insertVariable(v.key)}
                          className="flex flex-col items-center rounded-xl border border-[#25D366]/20 bg-[#25D366]/8 px-3 py-1.5 transition hover:bg-[#25D366]/15 active:scale-95"
                        >
                          <span className="font-mono text-[11px] font-semibold text-[#25D366]">{v.key}</span>
                          <span className="mt-0.5 text-[9px] text-gray-500 dark:text-[#8696A0]">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message / caption with embedded emoji toolbar */}
                  <div className={cn(
                    'rounded-2xl border bg-white dark:bg-[#202C33] transition focus-within:ring-1',
                    charLimit
                      ? 'border-red-400/50 focus-within:ring-red-400/20'
                      : charWarning
                        ? 'border-amber-400/40 focus-within:ring-amber-400/20'
                        : 'border-gray-200 dark:border-white/10 focus-within:border-[#25D366]/50 focus-within:ring-[#25D366]/20',
                  )}>
                    <textarea
                      ref={messageRef}
                      rows={5}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#8696A0] outline-none"
                      placeholder={isMedia
                        ? t('form.captionPlaceholder', { defaultValue: 'Add a caption… (optional)' })
                        : t('form.messagePlaceholder')}
                    />
                    <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 dark:border-white/5 px-2 py-2">
                      {QUICK_EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => insertAtCursor(e)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-gray-100 dark:hover:bg-white/5"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between">
                    <p className="text-[10px] text-gray-500 dark:text-[#8696A0]">
                      {isMedia
                        ? t('form.captionHint', { defaultValue: 'Caption is optional · *bold* _italic_' })
                        : t('form.variablesHint')}
                    </p>
                    <span className={cn('text-[10px] font-semibold tabular-nums',
                      charLimit ? 'text-red-400' : charWarning ? 'text-amber-400' : 'text-gray-500 dark:text-[#8696A0]')}>
                      {charCount.toLocaleString()} / 4,096
                    </span>
                  </div>
                  </>
                  )}
            </SectionCard>
          </div>

          {/* 3 · Audience */}
          <div className={mobileStep === 3 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={3} icon={Users} title={t('form.audienceSection')} subtitle={t('form.audienceSubtitle')}>
              {audienceContent}
            </SectionCard>
          </div>

          {/* 4 · Delivery */}
          <div className={mobileStep === 4 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={4} icon={Calendar} title={t('form.deliverySection')} subtitle={t('form.deliverySubtitle')}>
              {deliveryContent}
            </SectionCard>
          </div>

          {/* 5 · Safety check */}
          <div className={mobileStep === 5 ? 'block' : 'hidden sm:block'}>
            <SectionCard
              step={5}
              icon={ShieldCheck}
              title={t('safety.section', { defaultValue: 'Safety check' })}
              subtitle={t('safety.subtitle', {
                defaultValue: 'How this campaign will reach people — and what it costs your WhatsApp number.',
              })}
            >
              {safetyContent}
            </SectionCard>
          </div>

          {/* Validation error (form incomplete) */}
          {error && (
            <div className={cn(
              'flex items-start gap-2.5 rounded-xl border border-red-400/20 bg-red-400/8 px-4 py-3',
              mobileStep < TOTAL_STEPS ? 'hidden sm:flex' : 'flex',
            )}>
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* API failure — friendly, actionable explanation */}
          {submitError != null && (
            <div className={mobileStep < TOTAL_STEPS ? 'hidden sm:block' : 'block'}>
              <FriendlyError error={submitError} onRetry={submitBroadcast} />
            </div>
          )}

          {/* Connection gate — shown wherever the submit bar is reachable. */}
          {connectionNotice && (
            <div className={mobileStep < TOTAL_STEPS ? 'hidden sm:block' : 'block'}>
              {connectionNotice}
            </div>
          )}

          {/* Submit bar — desktop only */}
          <div className="hidden sm:flex items-center justify-between rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] px-6 py-4">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {preflight ? preflight.audience.deliverable : resolvedAudience.count}{' '}
                {resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-[#8696A0]">
                {blockedReason
                  ? blockedReason
                  : formData.sendNow
                    ? t('form.sendsNow')
                    : formData.scheduledAtLocal
                      ? t('form.scheduledFor', { date: formatSchedule(formData.scheduledAtLocal, formData.timezone) })
                      : t('form.noScheduleSet')}
              </p>
            </div>
            <button
              type="button"
              onClick={submitBroadcast}
              disabled={!isValid || submitting || Boolean(blockedReason)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-[#25D366]/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitLabel ?? t('form.createTitle')}
            </button>
          </div>
        </div>

        {/* ── Right: live preview sidebar — desktop only ── */}
        <div className="hidden lg:block">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[#25D366]" />
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('form.livePreview')}</p>
              </div>
              <PhonePreview
                message={previewText}
                mediaType={messageType}
                mediaUrl={mediaUrl}
                mediaFilename={mediaFilename}
              />
            </div>

            {resolvedAudience.count > 0 && (
              <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/8 p-4 text-center">
                <p className="text-2xl font-bold text-[#25D366]">
                  {preflight ? preflight.audience.deliverable : resolvedAudience.count}
                </p>
                <p className="text-xs text-gray-500 dark:text-[#8696A0]">
                  {resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')} {t('form.recipientsReady')}
                </p>
                {preflight && preflight.audience.deliverable !== preflight.audience.requested && (
                  <p className="mt-1 text-[10px] text-gray-400 dark:text-[#8696A0]/80">
                    {t('safety.filteredFrom', {
                      defaultValue: 'filtered from {{count}} selected',
                      count: preflight.audience.requested,
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Risk at a glance, so the verdict is visible from every step and not
                only from the one the user might never open.
                Dimmed while a new analysis is in flight: the numbers on screen
                describe the audience as it was 700ms ago, and showing them at
                full confidence is how a verdict for a different audience passes
                for the current one. */}
            {preflight && (
              <button
                type="button"
                onClick={() => setMobileStep(5)}
                className={cn(
                  'w-full rounded-2xl border p-4 text-start transition hover:brightness-110',
                  RISK_STYLES[preflight.riskLevel].ring,
                  RISK_STYLES[preflight.riskLevel].bg,
                  preflightLoading && 'opacity-50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {preflightLoading
                      ? <Loader2 className={cn('h-3.5 w-3.5 animate-spin', RISK_STYLES[preflight.riskLevel].text)} />
                      : preflight.riskLevel === 'LOW'
                        ? <ShieldCheck className={cn('h-3.5 w-3.5', RISK_STYLES[preflight.riskLevel].text)} />
                        : <AlertCircle className={cn('h-3.5 w-3.5', RISK_STYLES[preflight.riskLevel].text)} />}
                    <span className={cn('text-xs font-semibold', RISK_STYLES[preflight.riskLevel].text)}>
                      {preflightLoading
                        ? t('safety.rechecking', { defaultValue: 'Re-checking…' })
                        : riskLabel(preflight.riskLevel)}
                    </span>
                  </span>
                  <span className="text-[10px] tabular-nums text-gray-500 dark:text-[#8696A0]">{preflight.riskScore}/100</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
                  {preflight.simulation.summary.charAt(0).toUpperCase() + preflight.simulation.summary.slice(1)}
                  {' · '}
                  {preflight.simulation.ratePerHour}/hr
                </p>
              </button>
            )}

            {formData.name && (
              <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] p-4">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">{t('form.campaign')}</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white line-clamp-2">{formData.name}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile fixed bottom action bar ── */}
      <div className="fixed bottom-0 inset-x-0 z-30 sm:hidden border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] px-4 py-3">
        <div className="flex gap-3">
          {mobileStep > 1 && (
            <button
              type="button"
              onClick={() => setMobileStep((s) => s - 1)}
              className="h-12 rounded-xl border border-gray-200 dark:border-white/15 bg-gray-50 dark:bg-white/5 px-5 text-sm font-semibold text-gray-900 dark:text-white transition hover:bg-gray-100 dark:hover:bg-white/10 active:scale-95"
            >
              {t('form.back')}
            </button>
          )}
          {mobileStep < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={() => { if (stepValid[mobileStep - 1]) setMobileStep((s) => s + 1); }}
              disabled={!stepValid[mobileStep - 1]}
              className="flex flex-1 h-12 items-center justify-center rounded-xl bg-[#25D366] text-sm font-bold text-slate-950 transition hover:bg-[#25D366]/90 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
            >
              {t('form.next')}
            </button>
          ) : (
            <button
              type="button"
              onClick={submitBroadcast}
              disabled={!isValid || submitting || Boolean(blockedReason)}
              className="flex flex-1 h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-bold text-slate-950 transition hover:bg-[#25D366]/90 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitLabel ?? t('form.createTitle')}
            </button>
          )}
        </div>
      </div>

      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </form>
  );
}
