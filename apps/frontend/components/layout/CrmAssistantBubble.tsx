'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useLanguage } from '../providers/I18nProvider';
import { useDirection } from '../../hooks/useDirection';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { X, Send, Sparkles } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  failed?: boolean;
}

const PAGE_CONTEXT_EN: Record<string, string> = {
  '/conversations': 'conversations inbox',
  '/contacts': 'contacts management',
  '/templates': 'message templates',
  '/templates/builder': 'template builder',
  '/broadcasts': 'broadcasts',
  '/broadcasts/new': 'new broadcast',
  '/automations': 'automations',
  '/deals': 'deals pipeline',
  '/tasks': 'tasks',
  '/dashboard': 'dashboard analytics',
  '/settings': 'settings',
  '/tags': 'tags management',
  '/saved-replies': 'saved replies',
  '/admin/users': 'admin users',
  '/admin/teams': 'admin teams',
  '/admin/chatbot': 'AI chatbot settings',
};

const PAGE_CONTEXT_AR: Record<string, string> = {
  '/conversations': 'صندوق المحادثات',
  '/contacts': 'جهات الاتصال',
  '/templates': 'قوالب الرسائل',
  '/templates/builder': 'منشئ القوالب',
  '/broadcasts': 'الحملات',
  '/broadcasts/new': 'حملة جديدة',
  '/automations': 'الأتمتة',
  '/deals': 'خط الصفقات',
  '/tasks': 'المهام',
  '/dashboard': 'لوحة التحليلات',
  '/settings': 'الإعدادات',
  '/tags': 'الوسوم',
  '/saved-replies': 'الردود المحفوظة',
  '/admin/users': 'إدارة المستخدمين',
  '/admin/teams': 'إدارة الفرق',
  '/admin/chatbot': 'إعدادات الذكاء الاصطناعي',
};

const SESSION_KEY = 'crm-assistant-history';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <span className="block space-y-0.5">
      {lines.map((line, i) => {
        const isBullet = /^[-•*]\s/.test(line);
        const content = parseBold(isBullet ? line.replace(/^[-•*]\s/, '') : line);
        return (
          <span key={i} className={cn('block', isBullet && 'flex gap-1')}>
            {isBullet && <span className="mt-1 text-brand shrink-0">•</span>}
            <span>{content}</span>
          </span>
        );
      })}
    </span>
  );
}

function parseBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-ink">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <span className="h-2 w-2 rounded-full bg-ink-3 animate-bounce [animation-delay:0ms] [animation-duration:900ms]" />
      <span className="h-2 w-2 rounded-full bg-ink-3 animate-bounce [animation-delay:150ms] [animation-duration:900ms]" />
      <span className="h-2 w-2 rounded-full bg-ink-3 animate-bounce [animation-delay:300ms] [animation-duration:900ms]" />
    </div>
  );
}

export default function CrmAssistantBubble() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { t } = useTranslation('chat');
  const { language } = useLanguage();
  const { isRTL } = useDirection();

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [hasChecked, setHasChecked] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted conversation
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist conversation
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [messages]);

  // Check if CRM assistant is enabled
  useEffect(() => {
    if (!session || hasChecked) return;
    setHasChecked(true);
    api
      .get('/api/chatbot/settings')
      .then((s: { crmAssistantEnabled?: boolean }) => {
        setEnabled(s.crmAssistantEnabled !== false);
      })
      .catch(() => setEnabled(true));
  }, [session, hasChecked]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open && !minimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open, minimized]);

  // Focus input when opened
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open, minimized]);

  // Mobile header Bot button dispatches this event
  useEffect(() => {
    const handler = () => { setOpen((v) => !v); setMinimized(false); };
    document.addEventListener('toggle-crm-assistant', handler);
    return () => document.removeEventListener('toggle-crm-assistant', handler);
  }, []);

  const pageContextMap = language === 'ar' ? PAGE_CONTEXT_AR : PAGE_CONTEXT_EN;
  const currentPage = (() => {
    for (const [path, label] of Object.entries(pageContextMap)) {
      if (pathname?.startsWith(path)) return label;
    }
    return null;
  })();

  const quickPrompts = t('assistant.quickPrompts', { returnObjects: true }) as string[];

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setInput('');

      const userMsg: Message = { role: 'user', content: trimmed, ts: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      const contextPrefix = currentPage
        ? language === 'ar'
          ? `[المستخدم الآن في: ${currentPage}]\n\n`
          : `[User is currently on: ${currentPage}]\n\n`
        : '';

      const history = [...messages, userMsg]
        .slice(-12)
        .map(({ role, content }) => ({ role, content }));

      try {
        const data = (await api.post('/api/chatbot/chat', {
          message: contextPrefix + trimmed,
          history: history.slice(0, -1),
          locale: language,
        })) as { reply: string; error?: string };

        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply ?? data.error ?? t('assistant.error.generic'),
            ts: Date.now(),
          },
        ]);
      } catch (err: unknown) {
        let msg = t('assistant.error.generic');
        if (err instanceof Error) {
          const status = (err as Error & { status?: number }).status;
          if (status === 503 || err.message.toLowerCase().includes('api key')) {
            msg = t('assistant.error.noApiKey');
          } else if (status === 404) {
            msg = t('assistant.error.notFound');
          } else {
            msg = err.message;
          }
        }
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: msg, ts: Date.now(), failed: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, currentPage, language, t],
  );

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
  };

  const clearChat = () => {
    setMessages([]);
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  };

  if (!session || !enabled) return null;

  // An end-side drawer, not a floating bubble: a bubble pinned to the corner
  // sat on top of the inbox composer's send button. Opened from the sidebar,
  // the mobile header, or ⌘K — all of which dispatch `toggle-crm-assistant`.
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="assistant-backdrop"
            className="fixed inset-0 z-40 bg-[rgb(8_12_10/0.25)] sm:bg-transparent"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <motion.aside
            key="assistant-panel"
            dir={isRTL ? 'rtl' : 'ltr'}
            role="dialog"
            aria-label={t('assistant.title')}
            initial={{ x: isRTL ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: isRTL ? '-100%' : '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
            className="fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-line bg-surface shadow-pop sm:w-[400px]"
          >
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{t('assistant.title')}</p>
                {currentPage && <p className="truncate text-2xs text-ink-3">{t('assistant.subtitle', { page: currentPage })}</p>}
              </div>
              {messages.length > 0 && (
                <button type="button" onClick={clearChat} className="btn btn-ghost btn-sm">{t('assistant.clearChat')}</button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-icon btn-sm" aria-label={t('assistant.close')}>
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-line bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
                    {t('assistant.emptyHint')}
                  </div>
                  <div className="stagger space-y-1.5">
                    {Array.isArray(quickPrompts) && quickPrompts.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => send(p)}
                        className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-start text-xs text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-ink"
                      >
                        <Sparkles className="h-3 w-3 shrink-0 text-brand" aria-hidden="true" />
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    const prevSame = idx > 0 && messages[idx - 1].role === msg.role;
                    return (
                      <div key={msg.ts} className={cn('pop-enter flex flex-col', isUser ? 'items-end' : 'items-start', prevSame ? 'mt-0.5' : 'mt-3')}>
                        <div
                          dir="auto"
                          className={cn(
                            'max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                            isUser
                              ? 'rounded-ee-sm bg-brand text-brand-fg'
                              : cn('rounded-ss-sm bg-raised text-ink ring-1 ring-inset ring-line', msg.failed && 'bg-red-500/10 ring-red-500/30'),
                          )}
                        >
                          <MarkdownText text={msg.content} />
                        </div>
                        {!(idx < messages.length - 1 && messages[idx + 1].role === msg.role) && (
                          <span dir="ltr" className="mt-1 px-1 text-[10px] tabular-nums text-ink-4">{formatTime(msg.ts)}</span>
                        )}
                      </div>
                    );
                  })}
                  {loading && (
                    <div className="mt-3 inline-flex rounded-xl rounded-ss-sm bg-raised px-3 py-2.5 ring-1 ring-inset ring-line">
                      <TypingDots />
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 border-t border-line p-3 pb-safe">
              <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/15">
                <textarea
                  ref={inputRef}
                  dir="auto"
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKey}
                  placeholder={t('assistant.inputPlaceholder')}
                  disabled={loading}
                  rows={1}
                  className="max-h-24 flex-1 resize-none overflow-hidden bg-transparent py-1 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-4 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() || loading}
                  className="btn btn-primary btn-icon btn-sm"
                  aria-label={t('composer.sendMessage')}
                >
                  <Send className="icon-mirror" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
