'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users, MessageSquare, Calendar, Send, ChevronDown, ChevronUp,
  Tag, Search, X, Check, Clock, Zap, AlertCircle, Smartphone,
  ChevronLeft, ChevronRight, Image as ImageIcon, Video, Loader2,
  Globe, ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import FriendlyError from '../ui/FriendlyError';
import { cn } from '../../lib/utils';
import TemplateButtonsPreview from '../templates/TemplateButtonsPreview';
import { templateExtras } from '../../lib/template-engine/compiler';
import type { TemplateButton } from '../../lib/template-engine/schema';
import { useTags } from '../../hooks/useTags';
import { useDirection } from '../../hooks/useDirection';
import { useAudienceMatches } from '../../hooks/useAudienceMatches';
import AudienceFilterBuilder from '../contacts/AudienceFilterBuilder';
import { EMPTY_FILTER, type AudienceFilter } from '../../lib/audience-filter';
import { useChatOpen } from '../../stores/chat-open-store';
import { browserTimeZone, formatSchedule, nowAsWallClock, timeZoneOptions } from '../../lib/schedule';
import { usePreflight } from '../../hooks/usePreflight';
import { useWhatsAppConnection } from '../whatsapp/WhatsAppConnectProvider';
import ConnectWhatsAppModal from '../whatsapp/ConnectWhatsAppModal';
import SafetyReport from './SafetyReport';
import SendConfirmDialog from './SendConfirmDialog';
import { blockers, type PreflightFinding } from '../../lib/preflight';
import TemplatePicker, { renderTemplatePreview, templateBlanksFilled } from './TemplatePicker';
import type { MetaStatus } from '../templates/ApprovalStatus';
import { useRouter } from 'next/navigation';
import { CountrySelect, DEFAULT_PHONE_COUNTRY, checkPhone } from '../ui/PhoneInput';
import type { CountryCode } from 'libphonenumber-js';

/** Header media a template can carry, as the preview draws it. */
type PreviewMedia = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

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
    templateId?: string | null;
    templateVariables?: Record<string, string> | null;
  };
  /**
   * The campaign being edited, so pre-flight does not report the campaign as a
   * duplicate of itself.
   */
  currentBroadcastId?: string;
  submitLabel?: string;
  /** Show the send summary before saving — for creating, where saving sends. */
  confirmBeforeSave?: boolean;
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
  excludeReceivedFrom?: string | null;
  /** The approved Meta template this campaign transmits. */
  templateId?: string | null;
  /** Template variable name → contact field, e.g. {"first_name":"name"}. */
  templateVariables?: Record<string, string> | null;
}

interface TemplateSummary {
  id: string;
  name: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
  language?: string;
  variables?: string[] | null;
  /** WhatsApp's verdict — only APPROVED templates can carry a campaign. */
  metaStatus?: MetaStatus;
  metaRejectedReason?: string | null;
  /** Canonical payload — carries the footer and buttons. */
  payload?: unknown;
}

const TOTAL_STEPS = 5;

/**
 * The message as it lands in the customer's WhatsApp: an incoming bubble on the
 * chat wallpaper, header media on top. Uses WhatsApp's own colours in both
 * themes so it reads as "their phone", not as part of the CRM.
 */
function PhonePreview({ message, mediaType, mediaUrl, footer, buttons }: {
  message: string; mediaType?: PreviewMedia; mediaUrl?: string;
  footer?: string; buttons?: TemplateButton[];
}) {
  const { t } = useTranslation('broadcasts');
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hasContent = message.trim() || mediaType;
  return (
    <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-2xl border border-line shadow-lg">
      <div className="flex items-center gap-2 bg-[#008069] px-3 py-2 dark:bg-[#202c33]">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
          <span className="text-[9px] font-bold text-white">B</span>
        </div>
        <span className="truncate text-[11px] font-medium text-white">{t('form.businessPreview')}</span>
      </div>
      <div className="min-h-[170px] bg-[#efeae2] p-2.5 dark:bg-[#0b141a]">
        {hasContent ? (
          <div className="max-w-[92%] overflow-hidden rounded-lg rounded-ss-none bg-white shadow-sm dark:bg-[#202c33]">
            {mediaType && (
              <div className="p-1 pb-0">
                {mediaType === 'IMAGE' && mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl} alt="" className="max-h-28 w-full rounded-md object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="flex h-20 items-center justify-center rounded-md bg-black/70 text-white/80">
                    {mediaType === 'VIDEO' ? <Video className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                  </div>
                )}
              </div>
            )}
            <div className="px-2 pb-1.5 pt-1.5">
              {message.trim() && (
                <p dir="auto" className="whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-[#111b21] dark:text-[#e9edef]">
                  {message.length > 320 ? message.slice(0, 320) + '…' : message}
                </p>
              )}
              {footer && (
                <p dir="auto" className="mt-1 text-[10px] leading-4 text-[#667781] dark:text-[#8696a0]">{footer}</p>
              )}
              <p className="mt-0.5 text-end text-[9px] text-[#667781] dark:text-[#8696a0]">{now}</p>
            </div>
            <TemplateButtonsPreview buttons={buttons} size="sm" tone="auto" />
          </div>
        ) : (
          <div className="flex h-[150px] items-center justify-center px-4">
            <p className="text-center text-[10px] leading-relaxed text-[#667781]">{t('template.previewEmpty')}</p>
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
    <div className="sm:rounded-xl sm:border sm:border-line sm:bg-surface sm:p-6">
      <p className="mb-5 text-[13px] leading-5 text-ink-3 sm:hidden">{subtitle}</p>
      <div className="mb-5 hidden items-start gap-3 sm:flex">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10">
          <span className="text-[11px] font-bold text-brand">{step}</span>
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Icon className="h-4 w-4 text-brand" />
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>
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
  confirmBeforeSave,
  onBack,
  onSave,
}: BroadcastFormProps) {
  const router = useRouter();
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

  // The audience exclusion the pre-flight report can switch on, resolved
  // server-side because only the server knows who received a prior campaign.
  // (`excludeCold` used to sit here too — it belonged to the contact-quality
  // tiers of the ban-prevention engine, which no longer exist.)
  const [excludeReceivedFrom, setExcludeReceivedFrom] = useState<string | null>(null);
  /** Findings whose one-tap fix has already been applied, so the button settles. */
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());

  const [selectedContacts, setSelectedContacts] = useState<string[]>(initialRecipientSet);
  const [manualPhones, setManualPhones] = useState('');
  /** The country of typed numbers that don't start with + or 00. */
  const [manualCountry, setManualCountry] = useState<CountryCode>(DEFAULT_PHONE_COUNTRY);
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  // ── The template this campaign sends ───────────────────────────────────────
  // Distinct from the "insert template text" picker above, which only copies
  // wording into the message box. This is the approved Meta template that is
  // actually transmitted; on the Cloud API it is the only thing a broadcast
  // audience can receive.
  const [templateId, setTemplateId] = useState<string | null>(initialValues?.templateId ?? null);
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>(
    initialValues?.templateVariables ?? {},
  );
  /** Set when the pre-flight "Choose a template" fix sends the user here. */
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [customFields, setCustomFields] = useState<Array<{ key: string; label: string }>>([]);

  // Mobile wizard step (1-4)
  const [mobileStep, setMobileStep] = useState(1);
  // Live WhatsApp state — the send gate below reacts to it rather than checking
  // once at mount, so reconnecting re-enables the button without a reload.
  const { status: waStatus } = useWhatsAppConnection();
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    api
      .get<TemplateSummary[]>('/api/templates')
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Custom fields become mapping targets for template variables. A failure
    // here degrades to built-in fields only rather than blocking the composer.
    api
      .get<Array<{ key: string; label?: string; name?: string }>>('/api/custom-fields')
      .then((data) =>
        setCustomFields(
          (Array.isArray(data) ? data : []).map((f) => ({ key: f.key, label: f.label ?? f.name ?? f.key })),
        ),
      )
      .catch(() => {});
  }, []);

  /**
   * Typed numbers, each checked against the chosen country. Only valid ones are
   * ever sent, as full international numbers, and invalid lines block the
   * campaign until they are fixed or removed, so nothing is silently dropped.
   */
  const manualCheck = useMemo(() => {
    const lines = manualPhones.split('\n').map((line) => line.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      const result = checkPhone(line, manualCountry);
      if (result.ok) valid.push(result.e164);
      else invalid.push(line);
    }
    return { valid: Array.from(new Set(valid)), invalid };
  }, [manualPhones, manualCountry]);
  const normalizePhoneList = (_value: string) => manualCheck.valid;

  const normalizeTag = (value: string) => value.trim().toLowerCase();

  const allTags = useTags();

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

  const submitBroadcast = async (confirmed = false) => {
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

    if (confirmBeforeSave && !confirmed) {
      setConfirmOpen(true);
      return;
    }

    try {
      setSubmitting(true);
      await onSave({
        name: formData.name,
        // Stored for the campaign list and history; what is sent is the template.
        message: selectedTemplate?.content ?? formData.message,
        recipients,
        tag: formData.tag.trim() || undefined,
        // The wall clock goes out exactly as typed, with the zone it was typed in.
        scheduledAtLocal: formData.sendNow ? undefined : formData.scheduledAtLocal,
        timezone: formData.timezone,
        // Batch size and interval are no longer sent — the server derives them
        // from account health so there is exactly one pacing authority.
        excludeReceivedFrom,
        templateId,
        templateVariables: Object.keys(templateVariables).length ? templateVariables : undefined,
      });
    } catch (err) {
      // Surface a friendly cause instead of an unhandled rejection.
      setConfirmOpen(false);
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
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

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? null,
    [templates, templateId],
  );

  /**
   * A campaign is its approved template — WhatsApp delivers nothing else to
   * people outside the 24-hour window — so the message step is complete once a
   * template is chosen and every one of its blanks has a value.
   */
  const messageReady = Boolean(selectedTemplate) && templateBlanksFilled(selectedTemplate, templateVariables, customFields);

  const hasAudience =
    selectedContacts.length > 0 ||
    normalizePhoneList(manualPhones).length > 0 ||
    formData.tag.trim().length > 0;

  const isValid =
    formData.name.trim().length > 0 && messageReady && hasAudience && manualCheck.invalid.length === 0;

  // Per-step validation for the mobile wizard. The safety step has no gate of
  // its own: it reports, it does not withhold. The only hard stop is a server
  // blocker, and that is enforced on the Send button rather than by trapping the
  // user on a step with no way forward.
  const stepValid = [
    formData.name.trim().length > 0,
    messageReady,
    hasAudience && manualCheck.invalid.length === 0,
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

  // The preview shows what the first person in the audience will read, so a
  // wrong blank is obvious before anyone receives it.
  const sampleContact = useMemo(() => {
    const phone = selectedContacts[0];
    const contact = phone ? contacts.find((c) => c.phone === phone) : undefined;
    if (!contact) return null;
    const name = contact.name?.trim() ?? '';
    return { name, first_name: name.split(/\s+/)[0] ?? '', phone: contact.phone };
  }, [contacts, selectedContacts]);

  const previewText = selectedTemplate
    ? renderTemplatePreview(selectedTemplate, templateVariables, {
        customFields,
        labelFor: (field) => customFields.find((f) => f.key === field)?.label
          ?? t(`template.field${field.replace(/_(.)/g, (_m, c: string) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}`),
        sample: sampleContact,
      })
    : '';
  const previewMediaType = (selectedTemplate?.mediaType as PreviewMedia | undefined) ?? undefined;
  const previewMediaUrl = selectedTemplate?.mediaUrl ?? undefined;
  const previewExtras = templateExtras(selectedTemplate?.payload);

  const BackIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  // Why "Next" is disabled, so a greyed-out button never leaves someone guessing.
  const stepHints = [
    t('form.hintName'),
    t('form.hintMessage'),
    manualCheck.invalid.length ? t('form.manualInvalid', { count: manualCheck.invalid.length }) : t('form.errorNoRecipients'),
    t('form.errorNoSchedule'),
    '',
  ];

  // ── Live safety analysis ───────────────────────────────────────────────────
  // The exact recipient list that would be posted, so the report describes the
  // campaign the user is about to send rather than an approximation of it.
  const draftRecipients = useMemo(
    () => Array.from(new Set([...selectedContacts, ...normalizePhoneList(manualPhones)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedContacts, manualCheck],
  );

  const { report: preflight, loading: preflightLoading, error: preflightError } = usePreflight(
    {
      message: selectedTemplate?.content ?? formData.message,
      recipients: draftRecipients,
      tag: formData.tag.trim() || undefined,
      excludeReceivedFrom,
      templateVariables,
      // Without this the report would raise "needs a template" against a
      // campaign that already has one — the composer would show a blocker the
      // user had just resolved.
      templateId,
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
  const applyFix = useCallback((finding: PreflightFinding) => {
    // The old fix set adjusted pacing, quiet hours and pilot size — controls that
    // no longer exist. What remains are the two remedies the Cloud API actually
    // has: pick an approved template, or drop people who already received a
    // previous campaign.
    switch (finding.fix?.action) {
      case 'choose_template':
        // Step 2 is where the picker lives; opening it as well is what makes
        // this a fix rather than a redirect that leaves the user hunting.
        setMobileStep(2);
        setTemplatePickerOpen(true);
        requestAnimationFrame(() => {
          document.getElementById('campaign-template')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        break;
      case 'connect_channel':
        router.push('/settings?section=whatsapp');
        break;
      case 'exclude_already_received':
        // The server names the earlier campaign; the next pre-flight run then
        // leaves its recipients out and reports them as skipped.
        if (finding.fix.broadcastId) setExcludeReceivedFrom(finding.fix.broadcastId);
        break;
      default:
        break;
    }
    if (finding.fix) setAppliedFixes((prev) => new Set(prev).add(finding.key));
  }, [router]);

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
        : 'border-brand/30 bg-brand/10',
    )}>
      <div className="flex items-start gap-2.5">
        {connectionGate.connecting
          ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" />
          : <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand dark:text-brand" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{connectionGate.label}</p>
          <p className="mt-0.5 text-xs text-ink-3">
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
          className="btn btn-primary btn-sm shrink-0"
        >
          {t('form.waConnectCta', { defaultValue: 'Connect WhatsApp' })}
        </button>
      )}
    </div>
  ) : null;

  // ── Audience section content (shared between mobile/desktop) ──
  const audienceContent = (
    <>
      {allTags.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
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
                      : 'border-line bg-raised text-ink-3 hover:border-gray-300 dark:hover:border-white/20 hover:text-ink',
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
                      active ? 'bg-white/20 text-white' : 'bg-white/10 text-ink-3')}>
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
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
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
              <p className="text-xs text-ink-3">{t('form.tagFilterPlaceholder')}</p>
            )}
            {allTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setFormData({ ...formData, tag: tag.name })}
                className="btn btn-secondary btn-sm inline-flex"
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
                {tag._count !== undefined && (
                  <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold text-ink-3">
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
              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
                {filterLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="font-semibold text-brand">{matchedPhones?.size ?? 0}</span>
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
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t('form.contactsLabel', { count: filteredContacts.length })}
            {selectedContacts.length > 0 && (
              <span className="ms-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-brand">
                {t('form.selectedCount', { count: selectedContacts.length })}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            {selectedContacts.length > 0 && (
              <button type="button" onClick={() => setSelectedContacts([])} className="text-[10px] text-ink-3 transition hover:text-red-400">
                {t('form.clearAll')}
              </button>
            )}
            <button
              type="button"
              onClick={() => allFilteredSelected ? deselectAllFiltered() : selectAllFiltered()}
              disabled={filteredPhones.length === 0}
              className="text-[10px] font-medium text-brand transition hover:underline disabled:opacity-40"
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
          <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder={t('form.contactSearchPlaceholder')}
            className="field w-full ps-9 pe-10 transition"
          />
          {contactSearch && (
            <button type="button" onClick={() => setContactSearch('')} className="absolute end-3 top-1/2 -translate-y-1/2">
              <X className="h-3.5 w-3.5 text-ink-3" />
            </button>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-line bg-gray-50 dark:bg-canvas">
          {filterLoading && filteredContacts.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-8 text-center text-xs text-ink-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('form.filtering', { defaultValue: 'Applying filters…' })}
            </p>
          ) : filteredContacts.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-3">
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
                    selected ? 'bg-brand/8' : 'hover:bg-gray-50 dark:hover:bg-white/4',
                  )}
                >
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all',
                    selected ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 dark:border-white/25 bg-transparent')}>
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all',
                    selected ? 'bg-brand/20 text-brand' : 'bg-raised text-ink-3')}>
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-xs font-medium', selected ? 'text-ink' : 'text-ink-3')}>
                      {c.name ?? c.phone}
                    </p>
                    {c.name && <p className="truncate text-[10px] text-ink-4/60">{c.phone}</p>}
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
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
          {t('form.addManually')}
        </p>
        <label className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <span>{t('form.manualCountry')}</span>
          <CountrySelect
            value={manualCountry}
            onChange={setManualCountry}
            ariaLabel={t('form.manualCountry')}
            className="field field-sm w-auto max-w-[14rem]"
          />
        </label>
        <textarea
          rows={3}
          value={manualPhones}
          onChange={(e) => setManualPhones(e.target.value)}
          className={cn(
            'field w-full resize-none font-mono transition',
            manualCheck.invalid.length > 0 && 'border-red-400 focus:border-red-400',
          )}
          placeholder={'0501234567\n+971501234567\n+201012345678'}
          dir="ltr"
        />
        <p className="mt-1 text-[10px] text-ink-3">{t('form.manualHint')}</p>
        {(manualCheck.valid.length > 0 || manualCheck.invalid.length > 0) && (
          <div className="mt-2 space-y-1 text-[11px]" aria-live="polite">
            {manualCheck.valid.length > 0 && (
              <p className="flex items-center gap-1.5 text-brand">
                <Check className="h-3.5 w-3.5" />
                {t('form.manualValid', { count: manualCheck.valid.length })}
              </p>
            )}
            {manualCheck.invalid.length > 0 && (
              <div className="rounded-lg bg-red-500/[0.07] px-2.5 py-2 text-red-600 dark:text-red-400">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('form.manualInvalid', { count: manualCheck.invalid.length })}
                </p>
                <p dir="ltr" className="mt-1 font-mono text-[11px] opacity-90">
                  {manualCheck.invalid.slice(0, 6).join(' · ')}
                  {manualCheck.invalid.length > 6 ? ' …' : ''}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-gray-50 dark:bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink">{t('form.resolvedAudience')}</p>
          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold',
            resolvedAudience.count > 0
              ? 'border-brand/30 bg-brand/10 text-brand'
              : 'border-line bg-raised text-ink-3')}>
            {resolvedAudience.count}{' '}{resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: t('form.sourceSelected'), value: resolvedAudience.selectedCount },
            { label: t('form.sourceManual'), value: resolvedAudience.manualCount },
            { label: t('form.sourceTag'), value: resolvedAudience.tagCount },
          ].map(({ label, value }) => (
            <div key={label} className="min-w-0 rounded-lg bg-raised p-2.5 text-center">
              <p className="text-lg font-semibold text-ink">{value}</p>
              {/* `tracking-wider` on a translated label is what turns three even
                  columns into one that overflows. Let it wrap instead. */}
              <p className="text-[9px] uppercase leading-tight tracking-wide text-ink-3 break-words">{label}</p>
            </div>
          ))}
        </div>
        {resolvedAudience.preview.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {resolvedAudience.preview.map((r) => (
              <span key={r.phone} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-raised px-2.5 py-1 text-[10px] text-ink">
                <span className="truncate">{r.name ?? r.phone}</span>
                <span className="shrink-0 text-ink-3">· {r.source}</span>
              </span>
            ))}
            {resolvedAudience.count > resolvedAudience.preview.length && (
              <span className="inline-flex items-center rounded-full border border-line bg-raised px-2.5 py-1 text-[10px] text-ink-3">
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
            formData.sendNow ? 'border-brand/40 bg-brand/10' : 'border-line bg-white dark:bg-raised hover:border-gray-300 dark:hover:border-white/20',
          )}
        >
          <Zap className={cn('mt-0.5 h-5 w-5 shrink-0', formData.sendNow ? 'text-brand' : 'text-ink-3')} />
          <div className="flex-1">
            <p className={cn('text-sm font-semibold', formData.sendNow ? 'text-brand' : 'text-ink')}>
              {t('form.sendNowOption')}
            </p>
            <p className="mt-0.5 text-xs text-ink-3">{t('form.sendNowDesc')}</p>
          </div>
          {formData.sendNow && <Check className="h-4 w-4 shrink-0 text-brand" />}
        </button>

        <button
          type="button"
          onClick={() => setFormData({ ...formData, sendNow: false })}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4 text-left transition-all',
            !formData.sendNow ? 'border-brand/40 bg-brand/10' : 'border-line bg-white dark:bg-raised hover:border-gray-300 dark:hover:border-white/20',
          )}
        >
          <Clock className={cn('mt-0.5 h-5 w-5 shrink-0', !formData.sendNow ? 'text-brand' : 'text-ink-3')} />
          <div className="flex-1">
            <p className={cn('text-sm font-semibold', !formData.sendNow ? 'text-brand' : 'text-ink')}>
              {t('form.scheduleOption')}
            </p>
            <p className="mt-0.5 text-xs text-ink-3">{t('form.scheduleDesc')}</p>
          </div>
          {!formData.sendNow && <Check className="h-4 w-4 shrink-0 text-brand" />}
        </button>
      </div>

      {!formData.sendNow && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-3">{t('form.scheduleTime')}</p>
              <input
                type="datetime-local"
                value={formData.scheduledAtLocal}
                min={minWallClock}
                onChange={(e) => setFormData({ ...formData, scheduledAtLocal: e.target.value })}
                className="field w-full transition"
              />
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-3">
                <Globe className="h-3.5 w-3.5" />
                {t('form.timezone', { defaultValue: 'Time zone' })}
              </p>
              <select
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                className="field w-full transition"
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Echo back exactly what will be stored, so there is no doubt left. */}
          {formData.scheduledAtLocal && (
            <div className="flex items-start gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2.5">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
              <p className="text-xs text-ink-3">
                {t('form.willSendAt', { defaultValue: 'Sends at' })}{' '}
                <span className="font-semibold text-ink">
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
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand/8 px-4 py-3 sm:hidden">
          <p className="text-center text-2xl font-bold text-brand">{resolvedAudience.count}</p>
          <p className="text-center text-xs text-ink-3">
            {t('form.readyToReceive')}
          </p>
        </div>
      )}
    </>
  );

  // ── Pre-flight step content ──
  //
  // This step used to carry three controls — sending speed, quiet hours and a
  // pilot group — that shaped how aggressively an unofficial WhatsApp Web socket
  // was driven. On the official API none of them exist: Meta enforces the rate,
  // publishes the limit, and refuses what it will not accept. Leaving the
  // switches on screen would have been worse than removing them, because a
  // control that no longer controls anything is exactly the false assurance the
  // old safety engine was built to avoid.
  const safetyContent = (
    <div className="space-y-4">
      <SafetyReport report={preflight} onApplyFix={applyFix} />
    </div>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={handleFormKeyDown} className="relative pb-32 sm:pb-0">

      {/* ── Mobile wizard header ── */}
      <div className="mb-5 sm:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={mobileStep === 1 ? onBack : () => setMobileStep((s) => s - 1)}
            aria-label={t('form.back')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-raised active:bg-raised"
          >
            <BackIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tabular-nums text-ink-4">
              {mobileStep} / {TOTAL_STEPS}
            </p>
            <h2 className="truncate text-lg font-semibold leading-6 text-ink">{stepTitles[mobileStep - 1]}</h2>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span key={i} className="h-1 overflow-hidden rounded-full bg-raised">
              <span
                className="block h-full origin-left rounded-full bg-brand transition-transform duration-base ease-out rtl:origin-right"
                style={{ transform: `scaleX(${i < mobileStep ? 1 : 0})` }}
              />
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* ── Left: form sections ── */}
        <div className="min-w-0 space-y-4">

          {/* 1 · Campaign name */}
          <div className={mobileStep === 1 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={1} icon={Tag} title={t('form.nameSection')} subtitle={t('form.nameSubtitle')}>
              <div className="relative">
                <Tag className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
                <input
                  type="text"
                  required
                  autoFocus
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-xl border-2 border-line bg-white dark:bg-raised py-4 ps-12 pe-4 text-base font-semibold text-ink placeholder:text-ink-4/70 outline-none transition focus:border-brand/60 focus:ring-[3px] focus:ring-brand/15"
                  placeholder={t('form.namePlaceholder2')}
                />
              </div>
              <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-ink-4/70" />
                {t('form.nameHelper', { defaultValue: 'Only you see this — it helps you find the broadcast later. Recipients never see it.' })}
              </p>
            </SectionCard>
          </div>

          {/* 2 · Message */}
          <div className={mobileStep === 2 ? 'block' : 'hidden sm:block'}>
            <SectionCard step={2} icon={MessageSquare} title={t('form.messageSection')} subtitle={t('form.messageSubtitle')}>
                  {/* ── What actually gets delivered ──────────────────────────
                      On the official API a campaign reaches people who are
                      outside the 24-hour window, and WhatsApp accepts only an
                      approved template there. So this is the primary control,
                      above the message editor rather than tucked beside it. */}
                  <div id="campaign-template" className="mb-5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                      {t('template.label')}
                    </p>
                    <TemplatePicker
                      templates={templates}
                      value={templateId}
                      variableMapping={templateVariables}
                      customFields={customFields}
                      autoOpen={templatePickerOpen}
                      onChange={(id) => {
                        setTemplateId(id);
                        setTemplatePickerOpen(false);
                      }}
                      onMappingChange={setTemplateVariables}
                    />
                  </div>

                  {!selectedTemplate && (
                    <p className="text-[11px] leading-relaxed text-ink-3">
                      {t('template.needNew')}{' '}
                      <Link href="/templates/builder" className="font-semibold text-brand hover:underline">
                        {t('template.createNew')}
                      </Link>
                    </p>
                  )}

                  <div className="mt-6 border-t border-line pt-5 lg:hidden">
                    <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-ink-3">
                      <Smartphone className="h-3.5 w-3.5" />
                      {t('form.livePreview')}
                    </p>
                    <PhonePreview message={previewText} mediaType={previewMediaType} mediaUrl={previewMediaUrl} footer={previewExtras.footer} buttons={previewExtras.buttons} />
                  </div>
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
              <FriendlyError error={submitError} onRetry={() => void submitBroadcast(true)} />
            </div>
          )}

          {/* Connection gate — shown wherever the submit bar is reachable. */}
          {connectionNotice && (
            <div className={mobileStep < TOTAL_STEPS ? 'hidden sm:block' : 'block'}>
              {connectionNotice}
            </div>
          )}

          {/* Submit bar — desktop only */}
          <div className="hidden sm:flex items-center justify-between rounded-xl border border-line bg-surface px-6 py-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                {preflight ? preflight.audience.deliverable : resolvedAudience.count}{' '}
                {resolvedAudience.count === 1 ? t('form.recipientSingular') : t('form.recipientPlural')}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
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
              onClick={() => void submitBroadcast()}
              disabled={!isValid || submitting || Boolean(blockedReason)}
              className="btn btn-primary inline-flex disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitLabel ?? (formData.sendNow ? t('form.reviewSend') : t('form.reviewSchedule'))}
            </button>
          </div>
        </div>

        {/* ── Right: live preview sidebar — desktop only ── */}
        <div className="hidden lg:block">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="mb-4 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-brand" />
                <p className="text-sm font-semibold text-ink">{t('form.livePreview')}</p>
              </div>
              <PhonePreview message={previewText} mediaType={previewMediaType} mediaUrl={previewMediaUrl} footer={previewExtras.footer} buttons={previewExtras.buttons} />
            </div>

            {resolvedAudience.count > 0 && (
              <div className="rounded-xl border border-brand/20 bg-brand/8 p-4 text-center">
                <p className="text-2xl font-bold text-brand">
                  {preflight ? preflight.audience.deliverable : resolvedAudience.count}
                </p>
                <p className="text-xs text-ink-3">
                  {t('form.readyToReceive')}
                </p>
                {preflight && preflight.audience.deliverable !== preflight.audience.requested && (
                  <p className="mt-1 text-[10px] text-ink-4/80">
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
                  'w-full rounded-xl border p-4 text-start transition hover:brightness-110',
                  preflight.canSend
                    ? 'border-brand/30 bg-brand/[0.06]'
                    : 'border-red-500/30 bg-red-500/[0.06]',
                  preflightLoading && 'opacity-50',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {preflightLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                      : preflight.canSend
                        ? <ShieldCheck className="h-3.5 w-3.5 text-brand dark:text-brand" />
                        : <AlertCircle className="h-3.5 w-3.5 text-red-500" />}
                    <span className={cn(
                      'text-xs font-semibold',
                      preflight.canSend ? 'text-brand dark:text-brand' : 'text-red-500',
                    )}>
                      {preflightLoading
                        ? t('safety.rechecking', { defaultValue: 'Re-checking…' })
                        : preflight.canSend
                          ? t('safety.readyToSend', { defaultValue: 'Ready to send' })
                          : t('safety.cannotSend', { defaultValue: 'Cannot send yet' })}
                    </span>
                  </span>
                  <span className="text-[10px] tabular-nums text-ink-3">
                    {preflight.audience.deliverable.toLocaleString()}
                  </span>
                </div>
                {!preflight.canSend && blockers(preflight)[0] && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                    {blockers(preflight)[0].label}
                  </p>
                )}
              </button>
            )}

            {formData.name && (
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="text-[10px] uppercase tracking-wider text-ink-3">{t('form.campaign')}</p>
                <p className="mt-1 text-sm font-medium text-ink line-clamp-2">{formData.name}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile fixed bottom action bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
        {mobileStep < TOTAL_STEPS && !stepValid[mobileStep - 1] && stepHints[mobileStep - 1] && (
          <p className="mb-2 text-center text-[11px] text-ink-3">{stepHints[mobileStep - 1]}</p>
        )}
        <div className="flex gap-2">
          {mobileStep > 1 && (
            <button
              type="button"
              onClick={() => setMobileStep((s) => s - 1)}
              className="btn btn-secondary h-12 px-5 text-sm font-semibold active:scale-[0.98]"
            >
              {t('form.back')}
            </button>
          )}
          {mobileStep < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={() => { if (stepValid[mobileStep - 1]) setMobileStep((s) => s + 1); }}
              disabled={!stepValid[mobileStep - 1]}
              className="btn btn-primary h-12 flex-1 justify-center text-sm font-semibold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('form.next')}
              <NextIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submitBroadcast()}
              disabled={!isValid || submitting || Boolean(blockedReason)}
              className="btn btn-primary h-12 flex-1 justify-center gap-2 text-sm font-semibold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 icon-mirror" />}
              {submitLabel ?? (formData.sendNow ? t('form.reviewSend') : t('form.reviewSchedule'))}
            </button>
          )}
        </div>
      </div>

      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <SendConfirmDialog
        open={confirmOpen}
        busy={submitting}
        templateName={selectedTemplate?.name ?? ''}
        preview={previewText}
        recipients={preflight?.audience.deliverable ?? resolvedAudience.count}
        fromNumber={preflight?.channel.displayPhoneNumber ?? null}
        messagingLimit={preflight?.channel.messagingLimit ?? null}
        scheduledFor={formData.sendNow ? null : formatSchedule(formData.scheduledAtLocal, formData.timezone)}
        onConfirm={() => void submitBroadcast(true)}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  );
}
