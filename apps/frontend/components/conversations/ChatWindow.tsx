'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  Paperclip,
  Smile,
  X,
  Loader2,
  Mic,
  Square,
  Image as ImageIcon,
  FileText,
  Video,
  Music2,
  StickyNote,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Info,
  Users,
  User,
  GitBranch,
  ChevronDown,
  Phone,
  VideoIcon,
  MoreVertical,
  Zap,
  Bot,
  Tag,
  Plus,
  CheckCheck,
  RotateCcw,
  PanelRight,
  UserPlus,
  UserRound,
  CheckSquare,
  BriefcaseBusiness,
  FlaskConical,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Skeleton } from '../ui/Skeleton';
import { localeFor } from '../../lib/format';
import MessageBubble from '../messages/MessageRenderer';
import InteractiveComposer from '../chat/InteractiveComposer';
import InteractiveSidebar, { type SidebarMessage } from '../chat/InteractiveSidebar';
import SaveContactModal from './SaveContactModal';
import InternalNotes from './InternalNotes';
import AssignmentHistory from './AssignmentHistory';
import EmojiPicker from '../ui/EmojiPicker';
import Avatar from '../ui/Avatar';
import ForwardModal from './ForwardModal';
import ContactTagSelector from '../contacts/ContactTagSelector';
import QualificationPanel from '../leads/QualificationPanel';
import { useTranslation } from 'react-i18next';
import { api, apiForm } from '../../lib/api';
import { useSocket } from '../../hooks/useSocket';
import { useToast } from '../../hooks/useToast';
import { getSocket } from '../../lib/socket';
import { formatPhone } from '../../lib/phone';
import { useSession } from 'next-auth/react';
import { useDirection } from '../../hooks/useDirection';
import { useGlobalBot } from '../../hooks/useGlobalBot';
import { isManager } from '../../lib/roles';

interface Message {
  id: string;
  fromMe: boolean;
  senderType?: 'agent' | 'user' | string;
  direction?: 'INBOUND' | 'OUTBOUND';
  body: string;
  type?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaCaption?: string | null;
  mediaDuration?: number | null;
  timestamp: string;
  status?: 'SENT' | 'RECEIVED' | 'PROCESSED' | 'DELIVERED' | 'READ' | 'FAILED';
  replyToId?: string | null;
  replyToBody?: string | null;
  reactions?: Array<{ id: string; emoji: string; userId?: string | null; contactPhone?: string | null; user?: { id: string; name: string } | null }>;
}

interface Agent {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface Team {
  id: string;
  name: string;
}

interface Conversation {
  id: string;
  contact?: {
    id?: string;
    name: string | null;
    phone: string;
    customFields?: { avatarUrl?: string | null } | null;
  };
  messages?: Message[];
  status: string;
  pipeline?: string | null;
  assignedTo: string | null;
  assignedUser?: { id: string; name: string | null; email: string } | null;
  assignedTeamId?: string | null;
  assignedTeam?: { id: string; name: string } | null;
  // AI Bot fields
  botEnabled?: boolean;
  /** Tri-state per-chat override: true = force ON, false = force OFF, null/undefined = Auto (follow global rules). */
  botOverride?: boolean | null;
  botPausedUntil?: string | null;
}

interface ChatWindowProps {
  conversationId: string | null;
  recipientContacts?: Array<{ id: string; name: string | null; phone: string }>;
  onContactSaved?: () => void;
  onConversationNotFound?: () => void;
  /** Mobile only: return to the conversation list. */
  onBack?: () => void;
}

const ATTACHMENT_OPTIONS = [
  { labelKey: 'composer.attachPhoto',    accept: 'image/*',                                    icon: ImageIcon, tone: 'bg-sky-500/12 text-sky-600 dark:text-sky-300' },
  { labelKey: 'message.videoMessage',    accept: 'video/*',                                    icon: Video,     tone: 'bg-rose-500/12 text-rose-600 dark:text-rose-300' },
  { labelKey: 'composer.attachAudio',    accept: 'audio/*',                                    icon: Music2,    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  { labelKey: 'composer.attachDocument', accept: '.pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx', icon: FileText,  tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-300' },
];

const PIPELINE_STAGES = ['', 'LEAD', 'QUALIFIED', 'NEGOTIATION', 'WON', 'LOST'] as const;

function blocksToText(blocks: Array<{ type: string; [key: string]: unknown }>): string {
  return blocks.map((b) => {
    if (b.type === 'text') return (b.content as string) || '';
    if (b.type === 'media') return (b.caption as string) || '';
    if (b.type === 'promo') {
      const lines = [b.title as string, b.description as string].filter(Boolean);
      if (b.ctaLabel) lines.push(`\n→ ${b.ctaLabel}`);
      return lines.join('\n');
    }
    if (b.type === 'product') return `🛍️ ${b.name}\n💰 ${b.price}\n\n→ ${b.buttonLabel}`;
    if (b.type === 'reminder') return `📅 *${b.title}*\n${b.datetime}\n\n✓ ${b.confirmLabel}   ↺ ${b.rescheduleLabel}`;
    if (b.type === 'support') {
      const faqs = (b.faqs as string[]).map((f, i) => `${i + 1}. ${f}`).join('\n');
      return `${b.greeting}\n\n${faqs}`;
    }
    if (b.type === 'buttons') {
      const lines = (b.buttons as Array<{ label: string; action?: string; url?: string }>).map((btn) => {
        if (btn.action === 'call') return `📞 ${btn.label}`;
        if (btn.action === 'url' && btn.url) return `🔗 ${btn.label}: ${btn.url}`;
        return `↩ Reply: ${btn.label}`;
      });
      return lines.join('\n');
    }
    return '';
  }).filter(Boolean).join('\n\n');
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getPreferredAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
}

type RightPanelTab = 'details' | 'notes' | 'history';

// ── MessageDTO → legacy Message adapter ───────────────────────────────────────
// Used so the modern crm:event path (via useRealtimeSync / Zustand store) can
// also update ChatWindow's local state without a full re-fetch.
function dtoToMsg(dto: any): Message & { clientId?: string; schemaVersion?: number; renderable?: any } {
  const isOutbound = dto.direction === 'outbound';
  const content = dto.content ?? {};

  let body = '';
  let type: Message['type'] = undefined;
  let mediaUrl: string | null = null;
  let mediaMimeType: string | null = null;
  let mediaFileName: string | null = null;
  let mediaCaption: string | null = null;
  let mediaDuration: number | null = null;

  if (content.kind === 'text') {
    body = content.body ?? '';
  } else if (content.kind === 'media') {
    const m = content.media ?? {};
    body = content.caption ?? '';
    mediaCaption = content.caption ?? null;
    mediaUrl = m.url ?? null;
    mediaMimeType = m.mime ?? null;
    mediaFileName = m.fileName ?? null;
    mediaDuration = m.durationSec != null ? Math.round(m.durationSec) : null;
    const mt = (m.mediaType ?? '').toLowerCase();
    type = mt === 'image' || mt === 'sticker' ? 'IMAGE'
      : mt === 'video' ? 'VIDEO'
      : mt === 'audio' || mt === 'voice' ? 'AUDIO'
      : 'DOCUMENT';
  } else if (content.kind === 'template') {
    body = content.templateName ?? '';
  } else if (content.kind) {
    body = content.body ?? content.text ?? '';
  }

  const statusMap: Record<string, Message['status']> = {
    queued: 'PROCESSED', sending: 'SENT', provider_accepted: 'SENT',
    server_confirmed: 'SENT', delivered: 'DELIVERED', read: 'READ',
    received: 'RECEIVED', processed: 'PROCESSED', failed: 'FAILED', expired: 'FAILED',
  };

  return {
    id: dto.id,
    clientId: dto.clientId,
    fromMe: isOutbound,
    direction: isOutbound ? 'OUTBOUND' : 'INBOUND',
    body,
    type,
    mediaUrl,
    mediaMimeType,
    mediaFileName,
    mediaCaption,
    mediaDuration,
    timestamp: dto.timestamp,
    status: statusMap[(dto.status ?? '').toLowerCase()] ?? 'PROCESSED',
    replyToId: dto.reply?.messageId ?? null,
    replyToBody: dto.reply?.preview ?? null,
    // Carry normalized fields so MessageRenderer uses the rich renderable
    ...(dto.schemaVersion === 1 ? { schemaVersion: 1, renderable: dto.renderable } : {}),
  } as any;
}

function BotTestPanel({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const runSimulate = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError('');
    setSent(false);
    try {
      await api.post(`/api/conversations/${conversationId}/bot/simulate`, { message: input.trim() });
      setInput('');
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    } catch {
      setError(t('details.aiBotTestFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-2xs font-medium text-ink-3 transition-colors hover:text-ink">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        {t('details.aiBotTest')}
      </button>
    );
  }

  return (
    <div className="pop-enter rounded-lg border border-dashed border-line-strong p-2.5">
      <p className="mb-2 text-2xs font-medium text-ink-3">{t('details.aiBotTest')}</p>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSimulate()}
          placeholder={t('details.aiBotTestPlaceholder')}
          className="field field-sm flex-1"
        />
        <button
          type="button"
          onClick={runSimulate}
          disabled={loading || !input.trim()}
          className="btn btn-primary btn-icon btn-sm"
          aria-label={t('composer.sendMessage')}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Send className="icon-mirror" />}
        </button>
      </div>
      {sent && <p className="mt-1.5 text-2xs text-brand">{t('details.aiBotSimulated')}</p>}
      {error && <p className="mt-1.5 text-2xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export default function ChatWindow({ conversationId, recipientContacts = [], onContactSaved, onConversationNotFound, onBack }: ChatWindowProps) {
  const { t, i18n } = useTranslation(['chat', 'common', 'templates']);
  const chatLocale = localeFor(i18n.language);
  const router = useRouter();
  const { data: session } = useSession();
  const { dir, isRTL } = useDirection();
  const toast = useToast();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<File | null>(null);
  const [typingHint, setTypingHint] = useState('');
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const [savedReplies, setSavedReplies] = useState<Array<{ shortcut: string; message: string }>>([]);
  const [templates, setTemplates] = useState<Array<{
    id: string; name: string; content: string; type?: string;
    payload?: {
      // Legacy blocks format
      blocks?: Array<{ type: string; url?: string; caption?: string; mediaType?: string; [key: string]: unknown }>;
      category?: string;
      // Canonical format (new builder)
      body?: { text: string };
      header?: { type: string; url?: string; text?: string; filename?: string };
      footer?: { text: string };
      buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
    };
  }>>([]);
  const [templateFollowUp, setTemplateFollowUp] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveContactModal, setShowSaveContactModal] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>('details');
  // Default the details panel open only where it docks inline (2xl+). On smaller
  // screens it overlays the chat, so start closed to avoid covering it on load.
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; body: string; fromMe: boolean } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<any | null>(null);
  const [showInteractiveComposer, setShowInteractiveComposer] = useState(false);
  const [showInteractiveSidebar, setShowInteractiveSidebar] = useState(false);
  const [paginationCursor, setPaginationCursor] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isBotToggling, setIsBotToggling] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  // Global AI-bot master switch (synced live with the AI settings page).
  const { enabled: globalBotEnabled, saving: globalBotSaving, toggle: toggleGlobalBot } = useGlobalBot();
  const canToggleGlobalBot = isManager((session?.user as any)?.role);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiBarRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const isLoadingOlderRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const fetchConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const [convData, msgsData] = await Promise.all([
        api.get(`/api/conversations/${conversationId}`),
        api.get(`/api/conversations/${conversationId}/messages?limit=50`),
      ]);
      if (convData) {
        const { messages: _strippedMsgs, ...conversationMeta } = convData;
        setConversation({ ...conversationMeta, messages: msgsData?.messages ?? [] });
        setPaginationCursor(msgsData?.nextCursor ?? null);
        setHasOlderMessages(Boolean(msgsData?.hasMore));
      } else {
        setConversation(null);
        onConversationNotFound?.();
      }
    } catch {
      setConversation(null);
    }
  }, [conversationId, onConversationNotFound]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || !hasOlderMessages || isLoadingOlderRef.current || !paginationCursor) return;
    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    try {
      const data = await api.get(`/api/conversations/${conversationId}/messages?limit=50&cursor=${encodeURIComponent(paginationCursor)}`);
      if (data?.messages?.length) {
        setConversation((prev) => prev ? { ...prev, messages: [...data.messages, ...(prev.messages ?? [])] } : prev);
        setPaginationCursor(data.nextCursor ?? null);
        setHasOlderMessages(Boolean(data.hasMore));
        requestAnimationFrame(() => {
          const container = scrollContainerRef.current;
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
        });
      }
    } catch {
      // silent — user can scroll up again to retry
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [conversationId, hasOlderMessages, paginationCursor]);

  const markAsRead = useCallback(() => {
    if (!conversationId) return;
    api.put(`/api/conversations/${conversationId}/read`, {}).catch(() => {});
  }, [conversationId]);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await api.get('/api/teams/agents');
      setAgents(Array.isArray(data) ? data : []);
    } catch {
      setAgents([]);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    const role = (session?.user as any)?.role ?? '';
    const isAdmin = isManager(role);
    try {
      if (isAdmin) {
        const data = await api.get('/api/teams/all');
        setTeams(Array.isArray(data) ? data : []);
      } else {
        const data = await api.get('/api/teams');
        if (data?.team) setTeams([data.team]);
      }
    } catch {
      setTeams([]);
    }
  }, [session]);

  const fetchSavedReplies = useCallback(async () => {
    try {
      const data = await api.get('/api/saved-replies');
      setSavedReplies(Array.isArray(data) ? data : []);
    } catch {
      setSavedReplies([]);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await api.get('/api/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      setConversation(null);
      setIsScrolledToBottom(true);
      setUnreadWhileScrolled(0);
      setPaginationCursor(null);
      setHasOlderMessages(false);
      fetchConversation();
      markAsRead();
    }
    fetchAgents();
    fetchTeams();
    fetchSavedReplies();
    fetchTemplates();
  }, [conversationId, fetchConversation, fetchSavedReplies, fetchTemplates, fetchAgents, fetchTeams, markAsRead]);

  useEffect(() => {
    if (conversation?.contact?.phone) setRecipientPhone(conversation.contact.phone);
  }, [conversation?.contact?.phone]);

  // Notify conversation list to refetch when contact details change
  useEffect(() => {
    if (!conversation?.contact) return;
    try {
      window.dispatchEvent(new Event('conversations:refetch'));
    } catch {}
  }, [conversation?.contact?.id, conversation?.contact?.name]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
    // isScrolledToBottom intentionally excluded: we only auto-scroll when messages
    // arrive, not when the user manually scrolls to the bottom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.messages?.length]);

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsScrolledToBottom(true);
    setUnreadWhileScrolled(0);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target as Node))
        setShowAttachmentMenu(false);
    };
    if (showAttachmentMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAttachmentMenu]);

  useEffect(() => {
    if (!showTemplatePicker) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById('template-picker-container');
      if (el && !el.contains(e.target as Node)) setShowTemplatePicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplatePicker]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [message]);

  // Open the details panel by default only where it docks inline (2xl+),
  // so it never overlays the chat on load on smaller screens.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1536px)').matches) {
      setShowRightPanel(true);
    }
  }, []);

  useSocket('message:new', useCallback((data: any) => {
    if (data.conversationId !== conversationId) return;
    if (data.message) {
      setConversation((prev) => {
        if (!prev) return prev;
        const msgs = prev.messages ?? [];
        // If the server message already exists, ignore
        if (msgs.some((m) => m.id === data.message.id)) return prev;

        // Try to find an optimistic placeholder to replace:
        const optimisticIdx = msgs.findIndex((m: any) => {
          // Precise: match by clientId (best — avoids all false positives)
          if (data.message.clientId && (m as any).clientId === data.message.clientId) return true;
          if (!m.id?.toString().startsWith?.('optimistic-')) return false;
          // Fallback: exact body text match for optimistic placeholders
          if (m.body && data.message.body && m.body === data.message.body) return true;
          // Fallback: attachment placeholder like "[filename.ext]"
          if (m.body && m.body.startsWith('[') && m.body.endsWith(']')) {
            const inner = m.body.slice(1, -1);
            if (data.message.mediaFileName && data.message.mediaFileName === inner) return true;
          }
          return false;
        });
        let next: any[];
        if (optimisticIdx !== -1) {
          // replace optimistic with real message
          next = [...msgs];
          next[optimisticIdx] = data.message;
        } else {
          next = [...msgs, data.message];
        }
        next.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return { ...prev, messages: next };
      });
      setIsScrolledToBottom((atBottom) => {
        if (!atBottom && data.message.direction === 'INBOUND') {
          setUnreadWhileScrolled((n) => n + 1);
        }
        return atBottom;
      });
      // Notify conversation list about the new/updated message so sidebar updates in-place
      try {
        window.dispatchEvent(new CustomEvent('conversation:message', {
          detail: {
            conversationId,
            message: data.message,
          },
        }));
      } catch {}
    }
    markAsRead();
  }, [conversationId, markAsRead]));

  useSocket('conversation:updated', useCallback((data: any) => {
    if (data.conversationId !== conversationId) return;
    setConversation((prev) => {
      if (!prev) return prev;
      const { conversationId: _id, ...fields } = data;
      return { ...prev, ...fields };
    });
  }, [conversationId]));

  useSocket('message:reaction', useCallback((data: { conversationId: string; messageId: string; reactions: any[] }) => {
    if (data.conversationId !== conversationId) return;
    setConversation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages?.map((m) =>
          m.id === data.messageId ? { ...m, reactions: data.reactions } : m
        ),
      };
    });
  }, [conversationId]));

  useSocket('message:status', useCallback((data: { conversationId: string; messageId: string; status: string }) => {
    if (data.conversationId !== conversationId) return;
    setConversation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages?.map((m) =>
          m.id === data.messageId ? { ...m, status: data.status as any } : m
        ),
      };
    });
  }, [conversationId]));

  // Peer typing indicator (other agents typing in this conversation)
  useSocket('typing:start', useCallback((data: { conversationId: string }) => {
    if (data.conversationId === conversationId) setPeerTyping(true);
  }, [conversationId]));

  useSocket('typing:stop', useCallback((data: { conversationId: string }) => {
    if (data.conversationId === conversationId) setPeerTyping(false);
  }, [conversationId]));

  // ── Modern real-time path: crm:event (message.created) ────────────────────
  // This is the reliable backup path. useRealtimeSync already handles these
  // events to update the Zustand store; we duplicate the handling here so
  // ChatWindow's local state is also updated immediately without a re-fetch.
  useSocket('crm:event', useCallback((event: any) => {
    if (event.type !== 'message.created') return;
    const dto = event.payload?.message;
    if (!dto || dto.conversationId !== conversationId) return;

    const newMsg = dtoToMsg(dto);

    setConversation((prev) => {
      if (!prev) return prev;
      const msgs = prev.messages ?? [];
      if (msgs.some((m) => m.id === newMsg.id)) return prev;

      // Reconcile against an optimistic placeholder by clientId
      const optimisticIdx = msgs.findIndex((m: any) =>
        newMsg.clientId && m.clientId === newMsg.clientId,
      );
      let next: any[];
      if (optimisticIdx !== -1) {
        next = [...msgs];
        next[optimisticIdx] = newMsg;
      } else {
        next = [...msgs, newMsg];
      }
      next.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      return { ...prev, messages: next };
    });

    setIsScrolledToBottom((atBottom) => {
      if (!atBottom && dto.direction === 'inbound') {
        setUnreadWhileScrolled((n) => n + 1);
      }
      return atBottom;
    });

    // Notify conversation list sidebar
    try {
      window.dispatchEvent(new CustomEvent('conversation:message', {
        detail: { conversationId, message: newMsg },
      }));
    } catch {}

    markAsRead();
  }, [conversationId, markAsRead]));

  // ── Socket reconnect: refetch to catch messages missed while disconnected ──
  useEffect(() => {
    if (!conversationId) return;
    const s = getSocket();
    let connectedOnce = s.connected;

    function handleConnect() {
      if (connectedOnce) {
        // This is a RE-connect (not the initial connect); refetch to fill the gap.
        fetchConversation();
      }
      connectedOnce = true;
    }

    s.on('connect', handleConnect);
    return () => { s.off('connect', handleConnect); };
  }, [conversationId, fetchConversation]);

  // Polling fallback — ensures messages appear even when the socket isn't delivering events.
  // Runs every 5 s while the tab is visible; merges new messages without discarding older
  // loaded pages or pending optimistic placeholders.
  const pollForNewMessages = useCallback(async () => {
    if (!conversationId) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const data = await api.get(`/api/conversations/${conversationId}/messages?limit=30`);
      if (!data?.messages?.length) return;
      setConversation((prev) => {
        if (!prev) return prev;
        let msgs = [...(prev.messages ?? [])];
        let changed = false;
        for (const newMsg of data.messages) {
          if (msgs.some((m) => m.id === newMsg.id)) continue;
          // Replace optimistic placeholder if present (same logic as the socket handler)
          const optIdx = msgs.findIndex((m: any) => {
            if (!m.id?.toString().startsWith('optimistic-')) return false;
            if (newMsg.clientId && m.clientId === newMsg.clientId) return true;
            if (m.body && newMsg.body && m.body === newMsg.body) return true;
            return false;
          });
          if (optIdx !== -1) {
            msgs = [...msgs];
            msgs[optIdx] = newMsg;
          } else {
            msgs = [...msgs, newMsg];
          }
          changed = true;
        }
        if (!changed) return prev;
        msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return { ...prev, messages: msgs };
      });
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const id = setInterval(pollForNewMessages, 5000);
    return () => clearInterval(id);
  }, [conversationId, pollForNewMessages]);

  const contactName = useMemo(
    () => conversation?.contact?.name || formatPhone(conversation?.contact?.phone) || t('window.unknownContact'),
    [conversation?.contact?.name, conversation?.contact?.phone],
  );
  const contactPhone = useMemo(
    () => formatPhone(conversation?.contact?.phone),
    [conversation?.contact?.phone],
  );
  const contactId = conversation?.contact?.id;
  const contactAvatar = conversation?.contact?.customFields?.avatarUrl;
  const messages = conversation?.messages ?? [];
  const isOpen = conversation?.status === 'OPEN';
  const statusLabel = conversation?.status?.toLowerCase() || 'unknown';
  const recordingLabel = formatDuration(recordingSeconds || 0) || '0:00';

  const handleAssignAgent = async (agentId: string) => {
    if (!conversationId) return;
    setIsAssigning(true);
    try {
      await api.put(`/api/conversations/${conversationId}/assign`, { agentId: agentId || null });
      // socket conversation:updated handles state update
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignTeam = async (teamId: string) => {
    if (!conversationId) return;
    setIsAssigning(true);
    try {
      await api.put(`/api/conversations/${conversationId}/assign-team`, { teamId: teamId || null });
      // socket conversation:updated handles state update
    } finally {
      setIsAssigning(false);
    }
  };

  const handlePipelineChange = async (pipeline: string) => {
    if (!conversationId) return;
    await api.put(`/api/conversations/${conversationId}/pipeline`, { pipeline: pipeline || null });
    // socket conversation:updated handles state update
  };

  const handleStatusChange = async (status: string) => {
    if (!conversationId) return;
    await api.put(`/api/conversations/${conversationId}/status`, { status });
    // socket conversation:updated handles state update
  };

  const setBotOverride = async (botOverride: boolean | null) => {
    if (!conversationId || !conversation || isBotToggling) return;
    setIsBotToggling(true);
    try {
      const result = await api.put(`/api/conversations/${conversationId}/bot`, { botOverride });
      if (result) setConversation((prev) => prev ? { ...prev, botEnabled: result.botEnabled, botOverride: result.botOverride, botPausedUntil: result.botPausedUntil } : prev);
    } finally {
      setIsBotToggling(false);
    }
  };

  const handleBotResume = async () => {
    if (!conversationId || isBotToggling) return;
    setIsBotToggling(true);
    try {
      const result = await api.put(`/api/conversations/${conversationId}/bot/resume`, {});
      if (result) setConversation((prev) => prev ? { ...prev, botPausedUntil: result.botPausedUntil } : prev);
    } finally {
      setIsBotToggling(false);
    }
  };

  const emitTyping = useCallback((isTyping: boolean) => {
    if (!conversationId) return;
    try {
      const socket = getSocket();
      socket.emit(isTyping ? 'typing:start' : 'typing:stop', { conversationId });
    } catch { /* socket might not be ready */ }
  }, [conversationId]);

  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    // Emit typing start; auto-stop after 3 seconds of inactivity
    emitTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => emitTyping(false), 3000);
  }, [emitTyping]);

  const insertEmoji = (emoji: string) => {
    const cursorPos = textareaRef.current?.selectionStart || message.length;
    const nextValue = message.slice(0, cursorPos) + emoji + message.slice(cursorPos);
    setMessage(nextValue);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
    }, 0);
  };

  const openAttachmentPicker = (accept: string) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = accept;
    fileInputRef.current.click();
  };

  const stopRecording = useCallback(async () => {
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

  const startRecording = useCallback(async () => {
    setRecordingError(null);
    setRecordedAudio(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError(t('window.audioNotSupported'));
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
        setRecordedAudio(file);
        setAttachment(file);
      };
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
      recorder.start();
    } catch (error) {
      console.error('Recording failed:', error);
      setRecordingError(t('window.micPermissionError'));
      setIsRecording(false);
    }
  }, []);

  const sendMessage = async () => {
    const targetPhone = recipientPhone || conversation?.contact?.phone;
    if (!targetPhone) return;
    if (!message.trim() && !attachment && !recordedAudio) return;
    const clientId = crypto.randomUUID();
    const optimisticId = `optimistic-${clientId}`;
    try {
      setSendError(null);
      setIsSending(true);
      let finalMessage = message.trim();
      if (finalMessage.startsWith('/')) {
        const shortcut = finalMessage.split(/\s+/)[0];
        const match = savedReplies.find((reply) => reply.shortcut === shortcut);
        if (match) {
          const contactName = conversation?.contact?.name ?? '';
          const contactPhone = conversation?.contact?.phone ?? '';
          finalMessage = match.message.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => {
            if (k === 'name') return contactName;
            if (k === 'phone') return contactPhone;
            return '';
          });
          setTypingHint(`Expanded ${shortcut}`);
        }
      }
      // Optimistic: show message immediately
      const attachMime = attachment?.type ?? recordedAudio?.type ?? '';
      const optimisticMediaType: Message['type'] = attachMime.startsWith('image/')
        ? 'IMAGE' : attachMime.startsWith('video/')
        ? 'VIDEO' : attachMime.startsWith('audio/')
        ? 'AUDIO' : attachment || recordedAudio
        ? 'DOCUMENT' : undefined;
      const optimisticBlobUrl = (attachment || recordedAudio) &&
        (optimisticMediaType === 'IMAGE' || optimisticMediaType === 'VIDEO' || optimisticMediaType === 'AUDIO')
          ? URL.createObjectURL((attachment || recordedAudio) as File)
          : null;
      const optimisticMsg: Message & { clientId?: string } = {
        id: optimisticId,
        clientId,
        fromMe: true,
        direction: 'OUTBOUND',
        body: optimisticMediaType ? (finalMessage ?? '') : finalMessage,
        type: optimisticMediaType,
        mediaUrl: optimisticBlobUrl,
        mediaMimeType: attachMime || null,
        mediaFileName: attachment?.name ?? recordedAudio?.name ?? null,
        mediaCaption: optimisticMediaType ? (finalMessage ?? '') : undefined,
        status: 'PROCESSED',
        timestamp: new Date().toISOString(),
        replyToId: replyTo?.id ?? null,
        replyToBody: replyTo?.body ?? null,
      };
      setConversation((prev) => {
        if (!prev) return prev;
        return { ...prev, messages: [...(prev.messages ?? []), optimisticMsg] };
      });
      try {
        window.dispatchEvent(new CustomEvent('conversation:message', {
          detail: {
            conversationId,
            message: {
              id: optimisticMsg.id,
              body: optimisticMsg.body,
              fromMe: optimisticMsg.fromMe,
              timestamp: optimisticMsg.timestamp,
              status: optimisticMsg.status,
            },
          },
        }));
      } catch {}
      const pendingFollowUp = templateFollowUp;
      setMessage('');
      setAttachment(null);
      setRecordedAudio(null);
      setReplyTo(null);
      setTemplateFollowUp('');
      setShowEmojiBar(false);
      setShowAttachmentMenu(false);
      setTypingHint('');
      emitTyping(false);
      if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
      if (attachment || recordedAudio) {
        const media = attachment || recordedAudio;
        const caption = finalMessage;
        const formData = new FormData();
        formData.append('phone', targetPhone);
        formData.append('message', caption);
        formData.append('mediaCaption', caption);
        formData.append('media', media as File);
        formData.append('clientId', clientId);
        await apiForm(`/api/conversations/${conversationId}/reply`, formData);
        if (pendingFollowUp.trim()) {
          await api.post(`/api/conversations/${conversationId}/reply`, {
            phone: targetPhone,
            message: pendingFollowUp.trim(),
          });
        }
      } else {
        await api.post(`/api/conversations/${conversationId}/reply`, {
          phone: targetPhone,
          message: finalMessage,
          clientId,
          ...(replyTo ? { replyToId: replyTo.id, replyToBody: replyTo.body } : {}),
        });
      }
      // Keep optimistic message in place — socket 'message:new' will replace it smoothly.
    } catch (error: any) {
      // Remove optimistic message on failure
      setConversation((prev) => {
        if (!prev) return prev;
        return { ...prev, messages: (prev.messages ?? []).filter((m) => m.id !== optimisticId) };
      });

      // Handle warm-up daily limit errors (HTTP 429)
      if (error?.status === 429 && error?.data?.code === 'WARMUP_DAILY_LIMIT') {
        const { sent, limit, dayNumber, fullyUnlockedAt } = error.data;
        const unlockDate = fullyUnlockedAt ? new Date(fullyUnlockedAt).toLocaleDateString() : 'N/A';
        const errorMsg = `Daily limit reached: ${sent}/${limit} messages sent today. Resets at midnight. (Day ${dayNumber} of 15 warm-up — full capacity on ${unlockDate})`;
        toast.warning(errorMsg);
        setSendError(errorMsg);
      } else {
        const errorMsg = error instanceof Error ? error.message : t('window.failedToSend');
        setSendError(errorMsg);
      }
    } finally {
      setIsSending(false);
    }
  };

  const sendSidebarMessage = useCallback(async (msg: SidebarMessage) => {
    if (!conversationId) return;
    const targetPhone = recipientPhone || conversation?.contact?.phone || '';
    if (!targetPhone) return;
    const optimisticId = `optimistic-${Date.now()}`;
    const clientId = `client-${Date.now()}`;
    setConversation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [...(prev.messages ?? []), {
          id: optimisticId,
          clientId,
          fromMe: true,
          direction: 'OUTBOUND' as const,
          body: msg.text,
          status: 'PROCESSED',
          timestamp: new Date().toISOString(),
        }],
      };
    });
    try {
      await api.post(`/api/conversations/${conversationId}/reply`, {
        phone: targetPhone,
        message: msg.text,
        clientId,
      });
    } catch {
      setConversation((prev) => {
        if (!prev) return prev;
        return { ...prev, messages: (prev.messages ?? []).filter((m) => m.id !== optimisticId) };
      });
    }
  }, [conversationId, recipientPhone, conversation?.contact?.phone]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAttachment(file);
    setRecordedAudio(null);
    setShowAttachmentMenu(false);
    if (file?.type?.startsWith('audio/')) setTypingHint(t('window.audioAttachmentReady'));
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!conversationId) return;
    if (!confirm(t('window.deleteConfirmMsg'))) return;
    const backup = conversation?.messages ?? [];
    // Optimistic removal locally
    setConversation((prev) => {
      if (!prev) return prev;
      return { ...prev, messages: (prev.messages ?? []).filter((m) => m.id !== messageId) };
    });

    // If the message is an optimistic placeholder, skip API call
    if (messageId.startsWith('optimistic-')) {
      const last = (conversation?.messages ?? []).filter((m) => m.id !== messageId).slice(-1)[0] ?? null;
      if (last) {
        try { window.dispatchEvent(new CustomEvent('conversation:message', { detail: { conversationId, message: last } })); } catch {}
      } else {
        try { window.dispatchEvent(new Event('conversations:refetch')); } catch {}
      }
      return;
    }

    try {
      await api.delete(`/api/conversations/${conversationId}/messages/${messageId}`);
      fetchConversation().catch(() => {});
      try { window.dispatchEvent(new Event('conversations:refetch')); } catch {}
    } catch (err) {
      // restore backup on error
      setConversation((prev) => (prev ? { ...prev, messages: backup } : prev));
      setSendError(t('window.failedToDelete'));
    }
  };

  // ── Saved replies as slash commands ──────────────────────────────────────
  // "/" opens the matching saved replies above the composer, so a shortcut no
  // longer has to be remembered exactly to be useful.
  const slashQuery = message.startsWith('/') && !/\s/.test(message) ? message.slice(1).toLowerCase() : null;
  const slashMatches = slashQuery === null ? [] : savedReplies
    .filter((r) => r.shortcut.toLowerCase().replace(/^\//, '').includes(slashQuery))
    .slice(0, 6);
  const expandReply = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => {
    if (k === 'name') return conversation?.contact?.name ?? '';
    if (k === 'phone') return conversation?.contact?.phone ?? '';
    return '';
  });
  const pickSlash = (r: { shortcut: string; message: string }) => {
    setMessage(expandReply(r.message));
    setSlashIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pickSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMessage(''); return; }
    }
    handleKeyDown(e);
  };

  if (!conversationId) {
    return (
      <div dir={dir} className="relative flex h-full w-full min-w-0 items-center justify-center overflow-hidden bg-chat">
        <div className="chat-doodle pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="enter relative max-w-sm px-8 text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface shadow-soft">
            <MessageSquare className="h-6 w-6 text-brand" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{t('window.emptyTitle')}</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-3">{t('window.emptySubtitle')}</p>
          <p className="mt-6 inline-flex items-center gap-1.5 text-2xs text-ink-4">
            <span className="kbd">⌘</span><span className="kbd">K</span>
            <span className="ms-1">{t('common:palette.placeholder')}</span>
          </p>
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div dir={dir} className="relative flex h-full w-full min-w-0 flex-col bg-chat">
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2"><Skeleton className="h-3 w-36 rounded" /><Skeleton className="h-2.5 w-24 rounded" /></div>
        </div>
        <div className="flex-1 space-y-3 px-[6%] py-6" aria-hidden="true">
          {[52, 38, 64, 30, 46].map((w, i) => (
            <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
              <Skeleton className="h-10 rounded-lg" style={{ width: `${w}%` } as React.CSSProperties} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const assignee = conversation.assignedUser ? (conversation.assignedUser.name || conversation.assignedUser.email) : null;
  const headerSub = peerTyping
    ? null
    : [contactPhone, assignee ? t('header.assignedTo', { name: assignee }) : null].filter(Boolean).join(' · ');
  const resolved = conversation.status === 'RESOLVED' || conversation.status === 'ARCHIVED';

  // ── AI control, shared by the header pill and the details panel ──────────
  const botOverride: boolean | null = conversation.botOverride ?? (conversation.botEnabled ? true : null);
  const botPaused = botOverride === null && !!conversation.botPausedUntil && new Date(conversation.botPausedUntil) > new Date();
  const headerBot = (() => {
    if (globalBotEnabled === null) return null;
    if (canToggleGlobalBot) {
      const on = globalBotEnabled === true;
      return {
        on, busy: globalBotSaving,
        label: on ? t('header.aiGlobalOn') : t('header.aiGlobalOff'),
        title: t('details.headerBotTitle'),
        toggle: () => toggleGlobalBot(!on).catch(() => toast.error(t('details.headerBotError', { defaultValue: 'Failed to update the AI bot' }))),
      };
    }
    const forcedOff = conversation.botOverride === false;
    const on = !forcedOff && globalBotEnabled === true;
    return {
      on, busy: isBotToggling,
      label: on ? t('header.aiOn') : t('header.aiOff'),
      title: forcedOff
        ? t('details.headerBotEnableChat', { defaultValue: 'Enable bot for this conversation' })
        : t('details.headerBotDisableChat', { defaultValue: 'Disable bot for this conversation' }),
      toggle: () => setBotOverride(forcedOff ? null : false),
    };
  })();

  const selectCls = 'field field-sm appearance-none bg-no-repeat pe-8';
  const selectStyle: React.CSSProperties = {
    backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2389938E' d='M3 5l3 3 3-3z'/%3E%3C/svg%3E")`,
    backgroundPosition: isRTL ? 'left 10px center' : 'right 10px center',
  };

  const iconBtn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-raised hover:text-ink';

  return (
    <div dir={dir} className="relative flex h-full w-full min-w-0 overflow-hidden bg-chat">
      {/* ===== MAIN CHAT AREA ===== */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
          {onBack && (
            <button type="button" onClick={onBack} className={`${iconBtn} md:hidden`} aria-label={t('common:actions.back', 'Back')}>
              <ArrowLeft className="h-5 w-5 icon-mirror" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRightPanel((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-start transition-colors hover:bg-raised/60"
            title={t('header.details')}
          >
            <div className="relative shrink-0">
              <Avatar src={contactAvatar} name={contactName} contactId={contactId} size={40} />
              <span className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full ring-2 ring-surface ${
                statusLabel === 'open' ? 'bg-brand' : statusLabel === 'pending' ? 'bg-amber-400' : 'bg-ink-4'
              }`} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink"><bdi>{contactName}</bdi></h3>
                {!isOpen && <span className="chip chip-neutral shrink-0">{t(`details.statusOptions.${conversation.status}`, { defaultValue: conversation.status })}</span>}
              </div>
              {peerTyping ? (
                <p className="flex items-center gap-1 text-xs font-medium text-brand">{t('window.typing')}</p>
              ) : (
                <p className="truncate text-xs text-ink-3"><bdi>{headerSub}</bdi></p>
              )}
            </div>
          </button>

          {headerBot && (
            <button
              type="button"
              disabled={headerBot.busy}
              onClick={headerBot.toggle}
              title={headerBot.title}
              className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                headerBot.on ? 'border-brand/30 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-3 hover:text-ink'
              }`}
            >
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">{headerBot.label}</span>
              <span className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${headerBot.on ? 'bg-brand' : 'bg-line-strong'}`} aria-hidden="true">
                <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform duration-base ease-spring ${headerBot.on ? 'translate-x-3 rtl:-translate-x-3' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
              </span>
            </button>
          )}

          {!conversation?.contact?.name && (
            <button type="button" onClick={() => setShowSaveContactModal(true)} className="btn btn-secondary btn-sm hidden sm:inline-flex">
              <UserPlus aria-hidden="true" />
              {t('details.saveContactBtn')}
            </button>
          )}

          {/* One-click resolve: the most common way a conversation ends. */}
          <button
            type="button"
            onClick={() => handleStatusChange(resolved ? 'OPEN' : 'RESOLVED')}
            className={`btn btn-sm shrink-0 ${resolved ? 'btn-secondary' : 'btn-secondary'}`}
            title={resolved ? t('header.reopen') : t('header.resolve')}
          >
            {resolved ? <RotateCcw aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
            <span className="hidden sm:inline">{resolved ? t('header.reopen') : t('header.resolve')}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRightPanel((v) => !v)}
            className={`${iconBtn} ${showRightPanel ? 'bg-raised text-ink' : ''}`}
            aria-label={t('header.details')}
            aria-pressed={showRightPanel}
            title={t('header.details')}
          >
            <PanelRight className="h-[18px] w-[18px] icon-mirror" />
          </button>
        </header>

        {/* Messages */}
        <div className="relative flex-1 overflow-hidden">
          <div className="chat-doodle pointer-events-none absolute inset-0" aria-hidden="true" />
          <div
            ref={scrollContainerRef}
            className="relative h-full overflow-y-auto overflow-x-hidden px-3 pb-3 pt-3 sm:px-[5%] xl:px-[8%]"
            onScroll={() => {
              const el = scrollContainerRef.current;
              if (!el) return;
              const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              const atBottom = distanceFromBottom < 40;
              isAtBottomRef.current = atBottom;
              setIsScrolledToBottom(atBottom);
              if (atBottom) setUnreadWhileScrolled(0);
              if (el.scrollTop < 80) loadOlderMessages();
            }}
          >
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[300px] items-center justify-center">
                <div className="pop-enter max-w-xs rounded-xl bg-surface/90 px-6 py-5 text-center shadow-soft ring-1 ring-line">
                  <p className="text-[13px] font-semibold text-ink">{t('window.noMessages')}</p>
                  <p className="mt-1 text-xs text-ink-3">{t('window.noMessagesSubtitle')}</p>
                </div>
              </div>
            ) : (
              <>
                {isLoadingOlder && (
                  <div className="flex justify-center py-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-2xs text-ink-3 shadow-soft">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      {t('window.loadingOlder')}
                    </span>
                  </div>
                )}
                {messages.map((msg, idx) => {
                  const prev = messages[idx - 1];
                  const msgDate = new Date(msg.timestamp);
                  const prevDate = prev ? new Date(prev.timestamp) : null;
                  const sameSender = prev?.fromMe === msg.fromMe;
                  const showDateSeparator = !prev || (prevDate && msgDate.toDateString() !== prevDate.toDateString());
                  // Runs from one sender within 2 minutes stack tightly; only the first gets the tail.
                  const isGrouped = !!prev && sameSender && !showDateSeparator &&
                    (msgDate.getTime() - new Date(prev.timestamp).getTime() < 120000);

                  const dateLabel = (() => {
                    const today = new Date();
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    if (msgDate.toDateString() === today.toDateString()) return t('window.today');
                    if (msgDate.toDateString() === yesterday.toDateString()) return t('window.yesterday');
                    return msgDate.toLocaleDateString(chatLocale, { weekday: 'long', month: 'long', day: 'numeric' });
                  })();

                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="sticky top-1 z-[5] my-3 flex justify-center">
                          <span className="rounded-md bg-surface px-2.5 py-1 text-2xs font-medium text-ink-3 shadow-soft">
                            {dateLabel}
                          </span>
                        </div>
                      )}
                      <div className={`${String(msg.id).startsWith('optimistic-') ? 'pop-enter' : ''} w-full ${isGrouped ? 'mt-0.5' : 'mt-2'}`}>
                        <MessageBubble
                          message={msg as any}
                          conversationId={conversationId ?? undefined}
                          first={!isGrouped}
                          onReactionUpdate={(messageId, reactions) => {
                            setConversation((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                messages: prev.messages?.map((m) =>
                                  m.id === messageId ? { ...m, reactions } : m
                                ),
                              };
                            });
                          }}
                          onReply={(legacyMsg: any) => {
                            setReplyTo({ id: legacyMsg.id, body: legacyMsg.body || legacyMsg.mediaCaption || '', fromMe: legacyMsg.fromMe });
                            textareaRef.current?.focus();
                          }}
                          onDelete={handleDeleteMessage}
                          onForward={(m: any) => setForwardMessage(m)}
                        />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom */}
          {!isScrolledToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="pop-enter absolute bottom-4 end-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-ink-3 shadow-pop transition-colors hover:text-ink"
              aria-label={t('window.scrollToBottom')}
            >
              {unreadWhileScrolled > 0 && (
                <span className="absolute -top-1.5 -end-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold tabular-nums text-brand-fg">
                  {unreadWhileScrolled > 99 ? '99+' : unreadWhileScrolled}
                </span>
              )}
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Composer */}
        <footer className="relative z-10 shrink-0 border-t border-line bg-surface px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-3">
          {(peerTyping || sendError || recordingError || replyTo || attachment || recordedAudio || isRecording || slashMatches.length > 0) && (
            <div className="mb-2 space-y-2">
              {peerTyping && (
                <p className="flex items-center gap-2 px-1 text-xs text-ink-3">
                  <span className="inline-flex gap-0.5" aria-hidden="true">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:300ms]" />
                  </span>
                  {t('window.anotherAgentTyping')}
                </p>
              )}
              {sendError && (
                <div className="pop-enter flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <p className="flex-1">{sendError}</p>
                </div>
              )}
              {recordingError && (
                <div className="pop-enter rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  {recordingError}
                </div>
              )}
              {slashMatches.length > 0 && (
                <div className="pop-enter overflow-hidden rounded-lg border border-line bg-surface shadow-soft" role="listbox" aria-label={t('composer.savedReplies')}>
                  <p className="eyebrow border-b border-line px-3 py-1.5">{t('composer.savedReplies')}</p>
                  {slashMatches.map((r, i) => (
                    <button
                      key={r.shortcut}
                      type="button"
                      role="option"
                      aria-selected={i === slashIndex}
                      onMouseEnter={() => setSlashIndex(i)}
                      onClick={() => pickSlash(r)}
                      className={`flex w-full items-baseline gap-3 px-3 py-2 text-start transition-colors ${i === slashIndex ? 'bg-raised' : ''}`}
                    >
                      <span className="shrink-0 font-mono text-xs font-medium text-brand">{r.shortcut}</span>
                      <span className="truncate text-[13px] text-ink-2"><bdi>{expandReply(r.message)}</bdi></span>
                    </button>
                  ))}
                </div>
              )}
              {replyTo && (
                <div className="pop-enter flex items-start gap-3 rounded-lg border-s-[3px] border-brand bg-raised px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-brand">
                      {replyTo.fromMe ? t('window.replyingToSelf') : t('window.replyingTo', { name: contactName })}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-3"><bdi>{replyTo.body}</bdi></p>
                  </div>
                  <button type="button" onClick={() => setReplyTo(null)} className="btn btn-ghost btn-icon btn-sm -me-1" aria-label={t('composer.cancelReply')}>
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}
              {(attachment || recordedAudio) && (
                <div className="pop-enter flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    {recordedAudio ? <Mic className="h-4 w-4" /> : attachment?.type?.startsWith('image/') ? <ImageIcon className="h-4 w-4" /> : attachment?.type?.startsWith('video/') ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-medium text-ink-3">{recordedAudio ? t('window.voiceNoteReady') : t('window.attachmentReady')}</p>
                    <p className="truncate text-[13px] font-medium text-ink">{recordedAudio?.name || attachment?.name}</p>
                  </div>
                  <button type="button" onClick={() => { setAttachment(null); setRecordedAudio(null); setRecordingSeconds(0); }} className="btn btn-ghost btn-icon btn-sm" aria-label={t('composer.cancelRecording')}>
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}
              {isRecording && (
                <div className="pop-enter flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/25 dark:bg-red-500/10">
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <span className="voice-rec-wave inline-flex h-5 items-end gap-[3px] text-red-500" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => <span key={i} className="w-[3px] rounded-full bg-current" />)}
                  </span>
                  <span dir="ltr" className="font-mono text-sm font-semibold tabular-nums text-red-600 dark:text-red-300">{recordingLabel}</span>
                  <span className="ms-auto text-xs text-red-600 dark:text-red-300">{t('window.recording')}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-1">
            <div className="relative" ref={emojiBarRef}>
              <button
                ref={emojiButtonRef}
                onClick={() => setShowEmojiBar((v) => !v)}
                className={`${iconBtn} h-10 w-10 ${showEmojiBar ? 'bg-raised text-ink' : ''}`}
                type="button"
                aria-label={t('composer.pickEmoji')}
              >
                <Smile className="h-[22px] w-[22px]" />
              </button>
              {showEmojiBar && (
                <EmojiPicker
                  anchorRef={emojiButtonRef}
                  onSelect={(emoji) => { insertEmoji(emoji); }}
                  onClose={() => setShowEmojiBar(false)}
                />
              )}
            </div>

            <div className="relative" ref={attachmentMenuRef}>
              <button
                onClick={() => setShowAttachmentMenu((v) => !v)}
                className={`${iconBtn} h-10 w-10 ${showAttachmentMenu ? 'bg-raised text-ink' : ''}`}
                type="button"
                aria-label={t('composer.attachFile')}
                aria-expanded={showAttachmentMenu}
              >
                <Plus className={`h-[22px] w-[22px] transition-transform duration-base ease-out ${showAttachmentMenu ? 'rotate-45' : ''}`} />
              </button>
              <input ref={fileInputRef} type="file" onChange={handleAttachmentChange} className="hidden" />
              {showAttachmentMenu && (
                <div className="pop-enter absolute bottom-full start-0 z-50 mb-2 w-56 rounded-xl bg-surface p-1.5 shadow-pop">
                  {ATTACHMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.labelKey}
                        type="button"
                        onClick={() => openAttachmentPicker(option.accept)}
                        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium text-ink-2 transition-colors hover:bg-raised hover:text-ink"
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${option.tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        {t(option.labelKey)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {templates.length > 0 && (
              <div id="template-picker-container" className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker((v) => !v)}
                  className={`${iconBtn} h-10 w-10 ${showTemplatePicker ? 'bg-raised text-ink' : ''}`}
                  title={t('composer.insertTemplate')}
                  aria-label={t('composer.insertTemplate')}
                >
                  <FileText className="h-5 w-5" />
                </button>
                {showTemplatePicker && (
                  <div className="pop-enter absolute bottom-full start-0 z-50 mb-2 w-80 overflow-hidden rounded-xl bg-surface shadow-pop">
                    <div className="flex items-center justify-between border-b border-line px-3 py-2">
                      <span className="eyebrow">{t('templates:title')} · {templates.length}</span>
                      <button type="button" onClick={() => setShowTemplatePicker(false)} className="btn btn-ghost btn-icon btn-sm" aria-label={t('common:actions.close', 'Close')}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                    <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
                      {templates.map((tpl) => {
                        const contactNameV = conversation?.contact?.name ?? '';
                        const contactPhoneV = conversation?.contact?.phone ?? '';
                        const subst = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => {
                          if (k === 'name') return contactNameV;
                          if (k === 'phone') return contactPhoneV;
                          return '';
                        });

                        // Detect canonical vs legacy payload
                        const isCanonical = typeof tpl.payload?.body?.text === 'string';
                        const canonicalHeader = isCanonical ? tpl.payload?.header : undefined;
                        const canonicalMediaUrl = (
                          canonicalHeader &&
                          (canonicalHeader.type === 'IMAGE' || canonicalHeader.type === 'VIDEO' || canonicalHeader.type === 'DOCUMENT') &&
                          canonicalHeader.url
                        ) ? canonicalHeader.url : undefined;

                        // Legacy blocks
                        const blocks = (!isCanonical && tpl.payload?.blocks) ? tpl.payload.blocks : [];
                        const legacyMediaBlock = blocks.find((b) => b.type === 'media' && b.url);

                        // Resolved media URL (canonical takes priority)
                        const mediaUrl = canonicalMediaUrl ?? (legacyMediaBlock?.url as string | undefined);
                        const hasMedia = Boolean(mediaUrl);
                        const hasButtons = isCanonical
                          ? (tpl.payload?.buttons?.length ?? 0) > 0
                          : blocks.some((b) => b.type === 'buttons' || b.type === 'reminder' || b.type === 'support');

                        // Body text for the message input
                        let bodyText: string;
                        if (isCanonical && tpl.payload?.body) {
                          bodyText = subst(tpl.payload.body.text);
                          if (tpl.payload.footer?.text) bodyText += `\n\n_${tpl.payload.footer.text}_`;
                          if (tpl.payload.buttons?.length) {
                            bodyText += '\n\n' + tpl.payload.buttons.map((b, i) => {
                              if (b.type === 'URL' && b.url) return `🔗 ${b.text}: ${subst(b.url)}`;
                              if (b.type === 'PHONE_NUMBER' && b.phone_number) return `📞 ${b.text}: ${b.phone_number}`;
                              return `${i + 1}. ${b.text}`;
                            }).join('\n');
                          }
                        } else {
                          bodyText = blocks.length > 0
                            ? subst((legacyMediaBlock?.caption as string) || '')
                            : subst(tpl.content);
                        }

                        const previewText = isCanonical
                          ? subst(tpl.payload?.body?.text ?? tpl.content)
                          : (blocks.length > 0 ? subst(blocksToText(blocks)) : subst(tpl.content));

                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={async () => {
                              setMessage(bodyText);

                              // Legacy: set follow-up text for non-media blocks
                              if (!isCanonical) {
                                const nonMediaBlocks = blocks.filter((b) => b.type !== 'media');
                                const followUpText = nonMediaBlocks.length > 0 ? subst(blocksToText(nonMediaBlocks)) : '';
                                setTemplateFollowUp(legacyMediaBlock ? followUpText : '');
                              } else {
                                setTemplateFollowUp('');
                              }

                              // Fetch and attach media (both canonical and legacy)
                              if (mediaUrl) {
                                try {
                                  const resp = await fetch(mediaUrl);
                                  const blob = await resp.blob();
                                  const urlParts = mediaUrl.split('/');
                                  const rawFileName = urlParts[urlParts.length - 1] || 'media';
                                  const fileName = canonicalHeader?.filename ?? rawFileName;
                                  const file = new File([blob], fileName, { type: blob.type });
                                  setAttachment(file);
                                } catch {
                                  // media fetch failed — text still applied
                                }
                              }
                              setShowTemplatePicker(false);
                              textareaRef.current?.focus();
                            }}
                            className="w-full rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-raised"
                          >
                            <div className="flex items-center gap-1.5">
                              <p className="flex-1 truncate text-[13px] font-semibold text-ink">{tpl.name}</p>
                              {hasMedia && <span className="chip chip-violet">Media</span>}
                              {hasButtons && <span className="chip chip-info">Btns</span>}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-3"><bdi>{previewText}</bdi></p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => { handleMessageChange(e); setSlashIndex(0); }}
                onKeyDown={onComposerKeyDown}
                placeholder={t('composer.placeholder')}
                dir="auto"
                className="block max-h-[140px] min-h-[40px] w-full resize-none rounded-xl border border-transparent bg-raised px-4 py-2.5 text-[14px] leading-5 text-ink outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink-4 focus:border-line focus:bg-surface focus:ring-[3px] focus:ring-brand/10"
                rows={1}
              />
              {typingHint && (
                <span className="pointer-events-none absolute bottom-2.5 end-3 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                  {typingHint}
                </span>
              )}
            </div>

            {message.trim() || attachment || recordedAudio ? (
              <button
                onClick={sendMessage}
                disabled={isSending}
                className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-brand transition-colors hover:bg-brand-strong disabled:opacity-70"
                type="button"
                aria-label={t('composer.sendMessage')}
              >
                {isSending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px] icon-mirror" />}
              </button>
            ) : (
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`press flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isRecording ? 'bg-red-500 text-white' : 'text-ink-3 hover:bg-raised hover:text-ink'
                }`}
                type="button"
                aria-label={isRecording ? t('composer.stopRecording') : t('composer.recordVoice')}
              >
                {isRecording ? <Square className="h-[16px] w-[16px]" fill="currentColor" /> : <Mic className="h-[22px] w-[22px]" />}
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* ===== DETAILS PANEL ===== */}
      <AnimatePresence initial={false}>
        {showRightPanel && (
          <>
            {/* Overlay below the width where the panel can dock beside the chat */}
            <motion.div
              key="details-backdrop"
              className="absolute inset-0 z-40 bg-[rgb(8_12_10/0.3)] min-[1440px]:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowRightPanel(false)}
              aria-hidden="true"
            />
            <motion.aside
              key="details-panel"
              initial={{ x: isRTL ? '-100%' : '100%', opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: isRTL ? '-100%' : '100%', opacity: 0.6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 42 }}
              className="absolute inset-y-0 end-0 z-50 flex w-[min(92vw,360px)] flex-col border-s border-line bg-surface shadow-pop min-[1440px]:relative min-[1440px]:z-0 min-[1440px]:w-[340px] min-[1440px]:shadow-none"
            >
              {showInteractiveSidebar ? (
                <div className="flex h-full flex-col overflow-hidden">
                  <InteractiveSidebar
                    onSend={(msg) => { sendSidebarMessage(msg); }}
                    onClose={() => setShowInteractiveSidebar(false)}
                    contactName={conversation?.contact?.name ?? undefined}
                  />
                </div>
              ) : (
                <>
                  <div className="flex h-[60px] shrink-0 items-center justify-between gap-2 border-b border-line ps-4 pe-2">
                    <p className="truncate text-[13px] font-semibold text-ink">{t('details.conversationDetails')}</p>
                    <button type="button" onClick={() => setShowRightPanel(false)} className="btn btn-ghost btn-icon btn-sm" aria-label={t('common:actions.close', 'Close')}>
                      <X aria-hidden="true" />
                    </button>
                  </div>

                  {/* Tabs — the underline glides between them */}
                  <div className="flex shrink-0 gap-1 border-b border-line px-3" role="tablist">
                    {([
                      { id: 'details' as const, labelKey: 'details.tabDetails' },
                      { id: 'notes' as const, labelKey: 'details.tabNotes' },
                      { id: 'history' as const, labelKey: 'details.tabHistory' },
                    ]).map((tab) => {
                      const active = rightTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setRightTab(tab.id)}
                          className={`relative px-2 py-2.5 text-xs font-medium transition-colors ${active ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}
                        >
                          {t(tab.labelKey)}
                          {active && <motion.span layoutId="details-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-brand" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                        </button>
                      );
                    })}
                  </div>

                  {rightTab === 'details' && (
                    <div className="flex-1 overflow-y-auto">
                      {/* Contact */}
                      {conversation.contact && (
                        <section className="border-b border-line p-4">
                          <div className="flex items-center gap-3">
                            <Avatar src={contactAvatar} name={contactName} contactId={contactId} size={48} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-semibold text-ink"><bdi>{contactName}</bdi></p>
                              <p dir="ltr" className="truncate text-start text-xs tabular-nums text-ink-3">{contactPhone}</p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-1.5">
                            {contactId ? (
                              <button type="button" onClick={() => router.push(`/contacts/${contactId}`)} className="btn btn-secondary btn-sm px-2">
                                <UserRound aria-hidden="true" />
                                <span className="truncate">{t('panel.contact')}</span>
                              </button>
                            ) : (
                              <button type="button" onClick={() => setShowSaveContactModal(true)} className="btn btn-secondary btn-sm px-2">
                                <UserPlus aria-hidden="true" />
                                <span className="truncate">{t('details.saveContactBtn')}</span>
                              </button>
                            )}
                            <button type="button" disabled={!contactId} onClick={() => router.push(`/tasks?contactId=${contactId}`)} className="btn btn-secondary btn-sm px-2">
                              <CheckSquare aria-hidden="true" />
                              <span className="truncate">{t('details.task')}</span>
                            </button>
                            <button type="button" disabled={!contactId} onClick={() => router.push(`/deals?contactId=${contactId}`)} className="btn btn-secondary btn-sm px-2">
                              <BriefcaseBusiness aria-hidden="true" />
                              <span className="truncate">{t('details.deal')}</span>
                            </button>
                          </div>
                        </section>
                      )}

                      {/* Conversation fields */}
                      <section className="space-y-3 border-b border-line p-4">
                        <p className="eyebrow">{t('panel.conversation')}</p>
                        <label className="grid grid-cols-[96px_1fr] items-center gap-3">
                          <span className="text-xs text-ink-3">{t('details.status')}</span>
                          <select value={conversation.status} onChange={(e) => handleStatusChange(e.target.value)} className={selectCls} style={selectStyle}>
                            {['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'ARCHIVED', 'SPAM'].map((s) => (
                              <option key={s} value={s}>{t(`details.statusOptions.${s}`)}</option>
                            ))}
                          </select>
                        </label>
                        <label className="grid grid-cols-[96px_1fr] items-center gap-3">
                          <span className="flex items-center gap-1.5 text-xs text-ink-3">
                            {t('details.assignedAgent')}
                            {isAssigning && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                          </span>
                          <select value={conversation.assignedTo || ''} onChange={(e) => handleAssignAgent(e.target.value)} className={selectCls} style={selectStyle}>
                            <option value="">{t('details.unassigned')}</option>
                            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.email}</option>)}
                          </select>
                        </label>
                        <label className="grid grid-cols-[96px_1fr] items-center gap-3">
                          <span className="text-xs text-ink-3">{t('details.assignedTeam')}</span>
                          <select value={conversation.assignedTeamId || ''} onChange={(e) => handleAssignTeam(e.target.value)} className={selectCls} style={selectStyle}>
                            <option value="">{t('details.noTeam')}</option>
                            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                          </select>
                        </label>
                        <label className="grid grid-cols-[96px_1fr] items-center gap-3">
                          <span className="text-xs text-ink-3">{t('details.pipelineStage')}</span>
                          <select value={conversation.pipeline || ''} onChange={(e) => handlePipelineChange(e.target.value)} className={selectCls} style={selectStyle}>
                            {PIPELINE_STAGES.map((stage) => (
                              <option key={stage} value={stage}>{stage === '' ? t('details.pipeline.none') : t(`details.pipeline.${stage}`)}</option>
                            ))}
                          </select>
                        </label>
                      </section>

                      {/* AI agent for this chat */}
                      <section className="space-y-2.5 border-b border-line p-4">
                        <div className="flex items-center justify-between">
                          <p className="eyebrow">{t('panel.ai')}</p>
                          {isBotToggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-4" aria-hidden="true" />}
                        </div>
                        <div className="seg w-full">
                          {([
                            { value: null, label: t('details.aiBotModeAuto') },
                            { value: true, label: t('details.aiBotModeOn') },
                            { value: false, label: t('details.aiBotModeOff') },
                          ] as Array<{ value: boolean | null; label: string }>).map((m) => (
                            <button
                              key={String(m.value)}
                              type="button"
                              disabled={isBotToggling}
                              data-active={botOverride === m.value}
                              onClick={() => setBotOverride(m.value)}
                              className="seg-item flex-1 disabled:opacity-60"
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-2xs leading-4 text-ink-3">
                          {botOverride === null ? t('details.aiBotAutoHint') : botOverride ? t('details.aiBotOnHint') : t('details.aiBotOffHint')}
                        </p>
                        {botPaused && (
                          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2">
                            <p className="text-2xs font-medium text-amber-800 dark:text-amber-300">
                              {t('details.aiBotPaused', { time: new Date(conversation.botPausedUntil!).toLocaleTimeString(chatLocale, { hour: 'numeric', minute: '2-digit' }) })}
                            </p>
                            <button type="button" onClick={handleBotResume} disabled={isBotToggling} className="btn btn-secondary btn-sm h-7 shrink-0">
                              {t('details.aiBotResumeNow')}
                            </button>
                          </div>
                        )}
                        <BotTestPanel conversationId={conversationId!} />
                      </section>

                      {contactId && (
                        <section className="space-y-2.5 border-b border-line p-4">
                          <p className="eyebrow">{t('details.tags')}</p>
                          <ContactTagSelector contactId={contactId} />
                        </section>
                      )}

                      {contactId && (
                        <section className="p-4">
                          <QualificationPanel contactId={contactId} />
                        </section>
                      )}
                    </div>
                  )}

                  {rightTab === 'notes' && conversationId && (
                    <div className="flex-1 overflow-hidden">
                      <InternalNotes conversationId={conversationId} />
                    </div>
                  )}

                  {rightTab === 'history' && conversationId && (
                    <AssignmentHistory conversationId={conversationId} />
                  )}
                </>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {forwardMessage !== null && (
        <ForwardModal
          message={forwardMessage}
          onClose={() => setForwardMessage(null)}
        />
      )}

      {showInteractiveComposer && conversationId && (
        <InteractiveComposer
          conversationId={conversationId}
          phone={recipientPhone || conversation?.contact?.phone || ''}
          provider="meta"
          onClose={() => setShowInteractiveComposer(false)}
          onSent={() => {
            fetchConversation();
            try { window.dispatchEvent(new Event('conversations:refetch')); } catch {}
          }}
        />
      )}

      <SaveContactModal
        isOpen={showSaveContactModal}
        onClose={() => setShowSaveContactModal(false)}
        phone={conversation?.contact?.phone || ''}
        name={conversation?.contact?.name}
        onSuccess={() => {
          fetchConversation();
          try { window.dispatchEvent(new Event('conversations:refetch')); } catch {}
          onContactSaved?.();
        }}
      />
    </div>
  );
}
