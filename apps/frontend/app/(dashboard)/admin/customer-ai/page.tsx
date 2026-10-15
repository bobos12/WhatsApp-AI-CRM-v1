'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useDirection } from '@/hooks/useDirection';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Save, RotateCcw, CheckCircle2, AlertCircle, Bot, Info, Send, Sparkles, X,
  Eye, EyeOff, KeyRound, ListChecks, Ban, ShieldAlert,
  Thermometer, Hash, Timer, LayoutGrid, HelpCircle, Heart, TrendingUp, MessageSquare,
  ChevronRight, Gauge, PlugZap, UserRound, Hand, BookOpen, MessagesSquare, ShieldCheck,
  Users, Clock, Headset, SlidersHorizontal, FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import {
  Toggle, SettingRow, SettingsGroup, Field, TextInput, TextArea, Slider, SegmentedControl,
  TagListEditor, ChipMultiSelect, KeyValueEditor, SectionCard, MoreOptions, Card, SectionLabel,
} from '@/components/ai-config/primitives';
import { ProductsEditor } from '@/components/ai-config/ProductsEditor';
import { TemplatesModal } from '@/components/ai-config/TemplatesModal';
import { PageHeader, Switch } from '@/components/ui/page';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  AiConfig, AiConfigTemplate, BUILTIN_VARIABLES,
  Tone, EmojiUsage, ConfigLanguage, ArabicDialect, ResponseLength, SalesMode,
  TargetingMode, TargetingAudience,
} from '../ai-config/types';

type SectionId =
  | 'connection' | 'identity' | 'welcome' | 'knowledge' | 'flow'
  | 'rules' | 'audience' | 'schedule' | 'handoff' | 'advanced';

const SECTION_ORDER: SectionId[] = ['identity', 'welcome', 'knowledge', 'flow', 'rules', 'audience', 'schedule', 'handoff', 'connection', 'advanced'];
const SECTION_ICON: Record<SectionId, LucideIcon> = {
  connection: PlugZap, identity: UserRound, welcome: Hand, knowledge: BookOpen, flow: MessagesSquare,
  rules: ShieldCheck, audience: Users, schedule: Clock, handoff: Headset, advanced: SlidersHorizontal,
};

// ── Live status from /api/chatbot/status ──────────────────────────────────────
type RouteCandidate = { provider: 'gemini' | 'groq'; model: string };
type RoutingMap = { bot: RouteCandidate[]; qualification: RouteCandidate[]; assistant: RouteCandidate[] };
interface GroqModelStatus {
  model: string; available: boolean; secondsLeft: number; primary: boolean;
  quota: {
    remainingRequests: number | null; limitRequests: number | null;
    remainingTokens: number | null; limitTokens: number | null;
    resetRequests: string | null; resetTokens: string | null;
  } | null;
}
interface GeminiModelStatus { model: string; available: boolean; secondsLeft: number; requestsToday: number }
interface ChatStatus { models: GroqModelStatus[]; geminiModels: GeminiModelStatus[]; routing: RoutingMap }

// Friendly, consistent label for any routed model.
const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini · 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini · 2.5 Flash-Lite',
  'gemini-2.0-flash': 'Gemini · 2.0 Flash',
  'gemini-2.0-flash-lite': 'Gemini · 2.0 Flash-Lite',
  'llama-3.3-70b-versatile': 'Groq · Llama 70B',
  'llama-3.1-8b-instant': 'Groq · Llama 8B',
  'gemma2-9b-it': 'Groq · Gemma 9B',
  'llama3-8b-8192': 'Groq · Llama3 8B',
};
function modelLabel(model: string): string { return MODEL_LABELS[model] ?? model; }
function fmtNum(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * The AI agent's configuration. The rules underneath are strict and many —
 * none of them were removed. What changed is how they are reached: a section
 * index that tracks where you are, one save for everything (it used to be ten
 * save buttons that all saved the same object), the bot's test chat beside the
 * form so a change can be tried the moment it is made, and rarely-touched
 * technical settings folded away until asked for.
 */
export default function CustomerAiPage() {
  const { t } = useTranslation('aiconfig');
  const { isRTL } = useDirection();

  const [cfg, setCfg]                 = useState<AiConfig | null>(null);
  const [status, setStatus]           = useState<ChatStatus | null>(null);
  const [apiKey, setApiKey]           = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [targetingOptions, setTargetingOptions] = useState<{ tags: string[]; lifecycleStages: string[] }>({ tags: [], lifecycleStages: [] });
  const [hasApiKey, setHasApiKey]     = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [isDirty, setIsDirty]         = useState(false);
  const [error, setError]             = useState('');
  const [showApiKey, setShowApiKey]   = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [testOpen, setTestOpen]       = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('identity');

  // ── Load everything the page needs in one shot ───────────────────────────
  const load = useCallback(async () => {
    try {
      const [config, settings, options, st] = await Promise.all([
        api.get('/api/chatbot/ai-config'),
        api.get('/api/chatbot/settings').catch(() => null),
        api.get('/api/chatbot/targeting-options').catch(() => null),
        api.get('/api/chatbot/status').catch(() => null),
      ]);
      setCfg(config);
      setIsDirty(false);
      if (st) setStatus(st);
      if (settings) {
        setApiKey(settings.apiKey ?? '');
        setHasApiKey(Boolean(settings.apiKey));
        setGeminiApiKey(settings.geminiApiKey ?? '');
        setHasGeminiKey(Boolean(settings.geminiApiKey));
      }
      if (options) setTargetingOptions({ tags: options.tags ?? [], lifecycleStages: options.lifecycleStages ?? [] });
    } catch {
      setError(t('bot.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Keep the live quota meter fresh while the page is open.
  useEffect(() => {
    const id = setInterval(() => {
      api.get('/api/chatbot/status').then(setStatus).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, []);

  // ── Ctrl/Cmd+S ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && isDirty && !saving) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, saving, cfg, apiKey, geminiApiKey]);

  // Leaving with unsaved rules would silently drop them — ask first.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // ── Scroll-spy for the section index ─────────────────────────────────────
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!cfg) return;
    observer.current?.disconnect();
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id.replace('sec-', '') as SectionId);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    SECTION_ORDER.forEach((id) => { const el = document.getElementById(`sec-${id}`); if (el) io.observe(el); });
    observer.current = io;
    return () => io.disconnect();
  }, [cfg]);

  const jump = (id: SectionId) => {
    setActiveSection(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Save: config + shared connection together ─────────────────────────────
  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true); setError('');
    try {
      const [data] = await Promise.all([
        api.put('/api/chatbot/ai-config', cfg),
        api.put('/api/chatbot/settings', { apiKey, geminiApiKey }),
      ]);
      api.get('/api/chatbot/status').then(setStatus).catch(() => {});
      setCfg(data);
      setHasApiKey(Boolean(apiKey));
      setHasGeminiKey(Boolean(geminiApiKey));
      setIsDirty(false); setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bot.loadError'));
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (tpl: AiConfigTemplate) => {
    setCfg((c) => {
      if (!c) return c;
      const tc = tpl.config;
      return {
        ...c, ...tc,
        general:     { ...c.general,     ...(tc.general     ?? {}) },
        personality: { ...c.personality, ...(tc.personality ?? {}) },
        company:     { ...c.company,     ...(tc.company     ?? {}) },
        products:    { ...c.products,    ...(tc.products    ?? {}), items: tc.products?.items ?? c.products.items },
        sales:       { ...c.sales,       ...(tc.sales       ?? {}) },
        conversation:{ ...c.conversation,...(tc.conversation ?? {}) },
        safety:      { ...c.safety,      ...(tc.safety      ?? {}) },
        handoff:     { ...c.handoff,     ...(tc.handoff     ?? {}), triggers: { ...c.handoff.triggers, ...(tc.handoff?.triggers ?? {}) } },
        memory:      { ...c.memory,      ...(tc.memory      ?? {}) },
        gating:      { ...c.gating,      ...(tc.gating      ?? {}) },
        targeting:   { ...c.targeting,   ...(tc.targeting   ?? {}) },
        businessRules:   tc.businessRules   ?? c.businessRules,
        customVariables: tc.customVariables ?? c.customVariables,
      };
    });
    setIsDirty(true);
    setShowTemplates(false);
  };

  // ── Patch helpers ──────────────────────────────────────────────────────────
  const d               = ()                                      => setIsDirty(true);
  const update          = (p: Partial<AiConfig>)                  => { setCfg((c) => c ? { ...c, ...p } : c); d(); };
  const setGeneral      = (p: Partial<AiConfig['general']>)       => { setCfg((c) => c ? { ...c, general:      { ...c.general,      ...p } } : c); d(); };
  const setPersonality  = (p: Partial<AiConfig['personality']>)   => { setCfg((c) => c ? { ...c, personality:  { ...c.personality,  ...p } } : c); d(); };
  const setCompany      = (p: Partial<AiConfig['company']>)       => { setCfg((c) => c ? { ...c, company:      { ...c.company,      ...p } } : c); d(); };
  const setProducts     = (p: Partial<AiConfig['products']>)      => { setCfg((c) => c ? { ...c, products:     { ...c.products,     ...p } } : c); d(); };
  const setSales        = (p: Partial<AiConfig['sales']>)         => { setCfg((c) => c ? { ...c, sales:        { ...c.sales,        ...p } } : c); d(); };
  const setConversation = (p: Partial<AiConfig['conversation']>)  => { setCfg((c) => c ? { ...c, conversation: { ...c.conversation, ...p } } : c); d(); };
  const setSafety       = (p: Partial<AiConfig['safety']>)        => { setCfg((c) => c ? { ...c, safety:       { ...c.safety,       ...p } } : c); d(); };
  const setHandoff      = (p: Partial<AiConfig['handoff']>)       => { setCfg((c) => c ? { ...c, handoff:      { ...c.handoff,      ...p } } : c); d(); };
  const setHandoffTrig  = (k: keyof AiConfig['handoff']['triggers']) => { setCfg((c) => c ? { ...c, handoff: { ...c.handoff, triggers: { ...c.handoff.triggers, [k]: !c.handoff.triggers[k] } } } : c); d(); };
  const setMemory       = (p: Partial<AiConfig['memory']>)        => { setCfg((c) => c ? { ...c, memory:       { ...c.memory,       ...p } } : c); d(); };
  const setGating       = (p: Partial<AiConfig['gating']>)        => { setCfg((c) => c ? { ...c, gating:       { ...c.gating,       ...p } } : c); d(); };
  const setTargeting    = (p: Partial<AiConfig['targeting']>)     => { setCfg((c) => c ? { ...c, targeting:    { ...c.targeting,    ...p } } : c); d(); };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-5" role="status" aria-label="Loading AI settings">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-6 w-40 rounded" /><Skeleton className="h-3.5 w-72 max-w-full rounded" /></div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_1fr] xl:grid-cols-[200px_1fr_340px]">
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
        <div className="space-y-5"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
        <Skeleton className="hidden h-[480px] rounded-xl xl:block" />
      </div>
    </div>
  );
  if (!cfg) return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/25 dark:bg-red-500/10">
      <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
      <p className="text-[13px] text-red-700 dark:text-red-300">{error || t('bot.loadError')}</p>
    </div>
  );

  const c = cfg;
  const sec = t('bot.sections', { returnObjects: true }) as Record<SectionId, { title: string; subtitle: string; emoji: string }>;

  const SALES_MODES: Array<{ value: SalesMode; icon: LucideIcon; label: string; desc: string }> = [
    { value: 'off',          icon: HelpCircle,    label: t('bot.salesModes.offLabel'),          desc: t('bot.salesModes.offDesc') },
    { value: 'soft',         icon: Heart,         label: t('bot.salesModes.softLabel'),         desc: t('bot.salesModes.softDesc') },
    { value: 'hard',         icon: TrendingUp,    label: t('bot.salesModes.hardLabel'),         desc: t('bot.salesModes.hardDesc') },
    { value: 'consultation', icon: MessageSquare, label: t('bot.salesModes.consultationLabel'), desc: t('bot.salesModes.consultationDesc') },
  ];

  // Small status marks in the section index: what needs attention, at a glance.
  const navMark: Partial<Record<SectionId, 'warn' | 'on' | 'count'>> = {
    connection: hasApiKey || hasGeminiKey ? 'on' : 'warn',
    handoff: c.handoff.enabled ? 'on' : undefined,
    advanced: c.rawPromptOverride.trim() ? 'warn' : undefined,
  };
  const ruleCount = c.businessRules.length + c.safety.forbiddenTopics.length;

  const keyInput = (value: string, set: (v: string) => void, shown: boolean, toggle: () => void, placeholder: string) => (
    <div className="relative">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => { set(e.target.value); d(); }}
        placeholder={placeholder}
        dir="ltr"
        autoComplete="off"
        className="field pe-10 font-mono text-xs"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        aria-label={shown ? 'Hide key' : 'Show key'}
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('bot.title')}
        description={t('bot.subtitle')}
        meta={
          <span className={cn('chip', c.enabled ? 'chip-brand' : 'chip-neutral')}>
            {c.enabled && <span className="live-dot h-1.5 w-1.5" aria-hidden="true" />}
            {c.enabled ? t('bot.live') : t('bot.off')}
          </span>
        }
        actions={
          <>
            <button type="button" onClick={() => setShowTemplates(true)} className="btn btn-secondary">
              <LayoutGrid aria-hidden="true" />
              {t('bot.templates')}
            </button>
            <button type="button" onClick={() => setTestOpen(true)} className="btn btn-secondary xl:hidden">
              <FlaskConical aria-hidden="true" />
              {t('bot.testButton')}
            </button>
            <label className={cn(
              'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
              c.enabled ? 'border-brand/30 bg-brand/[0.06] text-ink' : 'border-line bg-surface text-ink-2',
            )}>
              <Switch checked={c.enabled} onChange={() => update({ enabled: !c.enabled })} size="sm" label={c.enabled ? t('bot.masterOn') : t('bot.masterOff')} />
              {c.enabled ? t('bot.masterOn') : t('bot.masterOff')}
            </label>
          </>
        }
      />

      {error && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/25 dark:bg-red-500/10">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-[13px] text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Section index — a chip strip on small screens */}
      <nav className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none lg:hidden" aria-label={t('bot.jumpTo')}>
        {SECTION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => jump(id)}
            className={cn('h-8 shrink-0 rounded-full px-3 text-xs font-medium transition-colors',
              activeSection === id ? 'bg-ink text-surface' : 'bg-raised text-ink-2 hover:text-ink')}
          >
            {sec[id].title}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[196px_minmax(0,1fr)] xl:grid-cols-[196px_minmax(0,1fr)_340px]">
        {/* ── Section index (desktop) ── */}
        <nav className="hidden lg:block" aria-label={t('bot.jumpTo')}>
          <div className="sticky top-6 space-y-0.5">
            <p className="eyebrow mb-2 px-2.5">{t('bot.jumpTo')}</p>
            {SECTION_ORDER.map((id) => {
              const Icon = SECTION_ICON[id];
              const active = activeSection === id;
              const mark = navMark[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => jump(id)}
                  className={cn(
                    'relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-[13px] transition-colors',
                    active ? 'bg-raised font-medium text-ink' : 'text-ink-3 hover:bg-raised/60 hover:text-ink',
                  )}
                >
                  {active && <motion.span layoutId="ai-sec" className="absolute inset-y-1.5 start-0 w-[2px] rounded-full bg-brand" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                  <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand' : 'text-ink-4')} aria-hidden="true" />
                  <span className="flex-1 truncate">{sec[id].title}</span>
                  {id === 'rules' && ruleCount > 0 && <span className="text-2xs tabular-nums text-ink-4">{ruleCount}</span>}
                  {mark === 'warn' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                  {mark === 'on' && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── Sections ── */}
        <div className="min-w-0 space-y-5">
          {/* Identity & Voice */}
          <div id="sec-identity" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.identity} title={sec.identity.title} subtitle={sec.identity.subtitle}>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('personality.assistantName')}>
                  <TextInput value={c.personality.assistantName} placeholder={t('personality.assistantNamePlaceholder')} onChange={(v) => setPersonality({ assistantName: v })} />
                </Field>
                <Field label={t('personality.language')}>
                  <SegmentedControl<ConfigLanguage>
                    value={c.personality.language}
                    onChange={(v) => setPersonality({ language: v })}
                    options={[
                      { value: 'auto', label: t('personality.langAuto') },
                      { value: 'en',   label: t('personality.langEn') },
                      { value: 'ar',   label: t('personality.langAr') },
                    ]}
                  />
                </Field>
              </div>
              {c.personality.language !== 'en' && (
                <Field label={t('personality.dialect')} hint={t('personality.dialectHint')}>
                  <SegmentedControl<ArabicDialect>
                    value={c.personality.dialect}
                    onChange={(v) => setPersonality({ dialect: v })}
                    options={[
                      { value: 'saudi',     label: t('personality.dialectSaudi') },
                      { value: 'gulf',      label: t('personality.dialectGulf') },
                      { value: 'egyptian',  label: t('personality.dialectEgyptian') },
                      { value: 'levantine', label: t('personality.dialectLevantine') },
                      { value: 'msa',       label: t('personality.dialectMsa') },
                    ]}
                  />
                </Field>
              )}
              <Field label={t('personality.persona')} hint={t('personality.personaHint')}>
                <TextArea value={c.personality.persona} rows={3} showCount softLimit={1200} placeholder={t('personality.personaPlaceholder')} onChange={(v) => setPersonality({ persona: v })} />
              </Field>
              <div className="grid gap-5">
                <Field label={t('personality.tone')}>
                  <SegmentedControl<Tone>
                    value={c.personality.tone}
                    onChange={(v) => setPersonality({ tone: v })}
                    options={[
                      { value: 'friendly',     label: t('personality.toneFriendly') },
                      { value: 'professional', label: t('personality.toneProfessional') },
                      { value: 'luxury',       label: t('personality.toneLuxury') },
                      { value: 'formal',       label: t('personality.toneFormal') },
                      { value: 'casual',       label: t('personality.toneCasual') },
                    ]}
                  />
                </Field>
                <Field label={t('personality.emoji')}>
                  <SegmentedControl<EmojiUsage>
                    value={c.personality.emojiUsage}
                    onChange={(v) => setPersonality({ emojiUsage: v })}
                    options={[
                      { value: 'none',   label: t('personality.emojiNone') },
                      { value: 'low',    label: t('personality.emojiLow') },
                      { value: 'medium', label: t('personality.emojiMedium') },
                      { value: 'high',   label: t('personality.emojiHigh') },
                    ]}
                  />
                </Field>
              </div>
              <MoreOptions>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Slider label={t('personality.formality')} value={c.personality.formality} display={c.personality.formality.toFixed(1)} onChange={(v) => setPersonality({ formality: v })} />
                  <Slider label={t('personality.humor')} value={c.personality.humorLevel} display={c.personality.humorLevel.toFixed(1)} onChange={(v) => setPersonality({ humorLevel: v })} />
                </div>
                <Field label={t('personality.writingStyle')} hint={t('personality.optional')}>
                  <TextArea value={c.personality.writingStyle} rows={2} placeholder={t('personality.writingStylePlaceholder')} onChange={(v) => setPersonality({ writingStyle: v })} />
                </Field>
              </MoreOptions>
            </SectionCard>
          </div>

          {/* Welcome */}
          <div id="sec-welcome" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.welcome} title={sec.welcome.title} subtitle={sec.welcome.subtitle}>
              <Field label={t('easy.welcome.message')} hint={t('easy.welcome.messageHint')}>
                <TextArea
                  value={c.conversation.welcomeMessage ?? ''}
                  rows={4}
                  showCount
                  placeholder={t('easy.welcome.messagePlaceholder')}
                  onChange={(v) => setConversation({ welcomeMessage: v })}
                />
                <p className="text-2xs text-ink-3">{t('easy.welcome.varsHint')}</p>
              </Field>
              <SettingsGroup>
                <SettingRow label={t('easy.welcome.exact')} description={t('easy.welcome.exactDesc')}>
                  <Toggle checked={c.conversation.welcomeMessageExact ?? false} onChange={() => setConversation({ welcomeMessageExact: !(c.conversation.welcomeMessageExact ?? false) })} />
                </SettingRow>
                <SettingRow label={t('conversation.greet')}>
                  <Toggle checked={c.conversation.alwaysGreet} onChange={() => setConversation({ alwaysGreet: !c.conversation.alwaysGreet })} />
                </SettingRow>
              </SettingsGroup>
            </SectionCard>
          </div>

          {/* Knowledge */}
          <div id="sec-knowledge" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.knowledge} title={sec.knowledge.title} subtitle={sec.knowledge.subtitle}>
              <Field label={t('company.services')}>
                <TextArea value={c.company.services} rows={4} showCount softLimit={4000} onChange={(v) => setCompany({ services: v })} />
              </Field>
              <Field label={t('company.pricing')}>
                <TextArea value={c.company.pricing} showCount onChange={(v) => setCompany({ pricing: v })} />
              </Field>
              <SettingsGroup>
                <SettingRow label={t('products.includeLabel')} description={c.products.enabled ? t('products.includeOn') : t('products.includeOff')}>
                  <Toggle checked={c.products.enabled} onChange={() => setProducts({ enabled: !c.products.enabled })} />
                </SettingRow>
              </SettingsGroup>
              {c.products.enabled && (
                <div className="space-y-4">
                  <Field label={t('products.currency')} hint={t('products.currencyHint')}>
                    <TextInput value={c.products.currency} placeholder={t('products.currencyPlaceholder')} className="max-w-[160px]" onChange={(v) => setProducts({ currency: v })} />
                  </Field>
                  <ProductsEditor items={c.products.items} onChange={(items) => setProducts({ items })} />
                </div>
              )}
              <MoreOptions label={t('easy.cards.services.more')}>
                <Field label={t('company.name')}><TextInput value={c.company.name} onChange={(v) => setCompany({ name: v })} /></Field>
                <Field label={t('company.about')}><TextArea value={c.company.about} showCount onChange={(v) => setCompany({ about: v })} /></Field>
                <Field label={t('company.faqs')}><TextArea value={c.company.faqs} rows={4} showCount softLimit={4000} onChange={(v) => setCompany({ faqs: v })} /></Field>
                <Field label={t('company.policies')}><TextArea value={c.company.policies} showCount onChange={(v) => setCompany({ policies: v })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('company.workingHours')}><TextInput value={c.company.workingHours} onChange={(v) => setCompany({ workingHours: v })} /></Field>
                  <Field label={t('company.contact')}><TextInput value={c.company.contact} onChange={(v) => setCompany({ contact: v })} /></Field>
                </div>
                <Field label={t('company.locations')}><TextArea value={c.company.locations} rows={2} onChange={(v) => setCompany({ locations: v })} /></Field>
                <Field label={t('company.notes')}><TextArea value={c.company.notes} showCount onChange={(v) => setCompany({ notes: v })} /></Field>
              </MoreOptions>
            </SectionCard>
          </div>

          {/* Conversation & Sales */}
          <div id="sec-flow" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.flow} title={sec.flow.title} subtitle={sec.flow.subtitle}>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">{t('bot.sellingStyle')}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
                  {SALES_MODES.map(({ value, icon: Icon, label, desc }) => {
                    const active = c.sales.mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSales({ mode: value })}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-start transition-colors',
                          active ? 'border-brand bg-brand/[0.05] ring-1 ring-inset ring-brand/40' : 'border-line hover:border-line-strong hover:bg-raised/50',
                        )}
                      >
                        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-brand/12 text-brand' : 'bg-raised text-ink-3')}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-ink">{label}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-ink-3">{desc}</span>
                        </span>
                        <span className={cn('mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-brand bg-brand' : 'border-line-strong')}>
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-fg" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Field label={t('sales.questions')} hint={t('easy.cards.flow.questions')}>
                <TagListEditor items={c.sales.leadQualificationQuestions} onChange={(v) => setSales({ leadQualificationQuestions: v })} placeholder={t('sales.questionsPlaceholder')} />
              </Field>
              <Field label={t('sales.cta')}>
                <TextInput value={c.sales.cta} onChange={(v) => setSales({ cta: v })} />
              </Field>

              <SettingsGroup>
                <SettingRow label={t('conversation.useName')}><Toggle checked={c.conversation.useCustomerName} onChange={() => setConversation({ useCustomerName: !c.conversation.useCustomerName })} /></SettingRow>
                <SettingRow label={t('conversation.askFollowUp')}><Toggle checked={c.conversation.askFollowUp} onChange={() => setConversation({ askFollowUp: !c.conversation.askFollowUp })} /></SettingRow>
                <SettingRow label={t('conversation.endCta')}><Toggle checked={c.conversation.alwaysEndWithCta} onChange={() => setConversation({ alwaysEndWithCta: !c.conversation.alwaysEndWithCta })} /></SettingRow>
                <SettingRow label={t('conversation.bulletPoints')}><Toggle checked={c.conversation.useBulletPoints} onChange={() => setConversation({ useBulletPoints: !c.conversation.useBulletPoints })} /></SettingRow>
              </SettingsGroup>

              <MoreOptions label={t('easy.cards.flow.more')}>
                <Field label={t('sales.bookingFlow')}><TextArea value={c.sales.bookingFlow} rows={2} onChange={(v) => setSales({ bookingFlow: v })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('sales.upsell')}><TextArea value={c.sales.upsell} rows={2} onChange={(v) => setSales({ upsell: v })} /></Field>
                  <Field label={t('sales.crossSell')}><TextArea value={c.sales.crossSell} rows={2} onChange={(v) => setSales({ crossSell: v })} /></Field>
                </div>
                <Field label={t('sales.closing')}><TextArea value={c.sales.closing} rows={2} onChange={(v) => setSales({ closing: v })} /></Field>
                <Field label={t('conversation.typingStyle')} hint={t('personality.optional')}>
                  <TextInput value={c.conversation.typingStyle} placeholder={t('conversation.typingStylePlaceholder')} onChange={(v) => setConversation({ typingStyle: v })} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('conversation.maxSentences')}><TextInput type="number" value={c.conversation.maxSentences} onChange={(v) => setConversation({ maxSentences: parseInt(v) || 0 })} /></Field>
                  <Field label={t('conversation.maxChars')}><TextInput type="number" value={c.conversation.maxResponseChars} onChange={(v) => setConversation({ maxResponseChars: parseInt(v) || 0 })} /></Field>
                </div>
              </MoreOptions>
            </SectionCard>
          </div>

          {/* Rules & Safety */}
          <div id="sec-rules" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.rules} title={sec.rules.title} subtitle={sec.rules.subtitle}>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-brand" aria-hidden="true" />
                  <p className="text-[13px] font-medium text-ink">{t('bot.alwaysDo')}</p>
                </div>
                <p className="text-xs text-ink-3">{t('bot.alwaysDoHint')}</p>
                <TagListEditor items={c.businessRules} onChange={(v) => update({ businessRules: v })} multiline placeholder={t('bot.rulePlaceholder')} />
              </div>

              <div className="h-px bg-line" />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Ban className="h-4 w-4 text-red-500" aria-hidden="true" />
                  <p className="text-[13px] font-medium text-ink">{t('bot.neverTopics')}</p>
                </div>
                <p className="text-xs text-ink-3">{t('bot.neverTopicsHint')}</p>
                <TagListEditor items={c.safety.forbiddenTopics} onChange={(v) => setSafety({ forbiddenTopics: v })} placeholder={t('safety.forbiddenPlaceholder')} />
              </div>

              <div className="h-px bg-line" />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <p className="text-[13px] font-medium text-ink">{t('bot.strictLimits')}</p>
                </div>
                <SettingsGroup>
                  <SettingRow label={t('safety.businessOnly')} description={t('safety.businessOnlyDesc')}><Toggle checked={c.safety.businessOnlyMode} onChange={() => setSafety({ businessOnlyMode: !c.safety.businessOnlyMode })} /></SettingRow>
                  <SettingRow label={t('safety.political')}><Toggle checked={c.safety.refusePolitical} onChange={() => setSafety({ refusePolitical: !c.safety.refusePolitical })} /></SettingRow>
                  <SettingRow label={t('safety.religious')}><Toggle checked={c.safety.refuseReligious} onChange={() => setSafety({ refuseReligious: !c.safety.refuseReligious })} /></SettingRow>
                  <SettingRow label={t('safety.medical')}><Toggle checked={c.safety.refuseMedical} onChange={() => setSafety({ refuseMedical: !c.safety.refuseMedical })} /></SettingRow>
                  <SettingRow label={t('safety.legal')}><Toggle checked={c.safety.refuseLegal} onChange={() => setSafety({ refuseLegal: !c.safety.refuseLegal })} /></SettingRow>
                  <SettingRow label={t('safety.safeMode')} description={t('safety.safeModeDesc')}><Toggle checked={c.safety.safeMode} onChange={() => setSafety({ safeMode: !c.safety.safeMode })} /></SettingRow>
                </SettingsGroup>
              </div>
            </SectionCard>
          </div>

          {/* Audience */}
          <div id="sec-audience" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.audience} title={sec.audience.title} subtitle={sec.audience.subtitle}>
              <Field label={t('audience.who')} hint={c.targeting.mode === 'all' ? t('audience.noteAll') : t('audience.noteRules')}>
                <SegmentedControl<TargetingMode>
                  value={c.targeting.mode}
                  onChange={(v) => setTargeting({ mode: v })}
                  options={[{ value: 'all', label: t('audience.everyone') }, { value: 'rules', label: t('audience.matching') }]}
                />
              </Field>
              {c.targeting.mode === 'rules' && (
                <div className="space-y-5 rounded-lg border border-line bg-raised/30 p-4">
                  <Field label={t('audience.includeTags')} hint={t('audience.includeTagsHint')}>
                    <ChipMultiSelect options={targetingOptions.tags} selected={c.targeting.includeTags} onChange={(v) => setTargeting({ includeTags: v })} emptyLabel={t('audience.includeTagsEmpty')} />
                  </Field>
                  <Field label={t('audience.excludeTags')} hint={t('audience.excludeTagsHint')}>
                    <ChipMultiSelect options={targetingOptions.tags} selected={c.targeting.excludeTags} onChange={(v) => setTargeting({ excludeTags: v })} emptyLabel={t('audience.excludeTagsEmpty')} />
                  </Field>
                  <Field label={t('audience.lifecycle')} hint={t('audience.lifecycleHint')}>
                    <ChipMultiSelect options={targetingOptions.lifecycleStages} selected={c.targeting.lifecycleStages} onChange={(v) => setTargeting({ lifecycleStages: v })} />
                  </Field>
                  <Field label={t('audience.newVsReturning')}>
                    <SegmentedControl<TargetingAudience>
                      value={c.targeting.audience}
                      onChange={(v) => setTargeting({ audience: v })}
                      options={[
                        { value: 'all',            label: t('audience.all') },
                        { value: 'new_only',       label: t('audience.newOnly') },
                        { value: 'returning_only', label: t('audience.returningOnly') },
                      ]}
                    />
                  </Field>
                </div>
              )}
              <SettingsGroup>
                <SettingRow label={t('audience.overrideLabel')} description={t('audience.overrideDesc')}>
                  <Toggle checked={c.targeting.respectPerChatOverride} onChange={() => setTargeting({ respectPerChatOverride: !c.targeting.respectPerChatOverride })} />
                </SettingRow>
              </SettingsGroup>
            </SectionCard>
          </div>

          {/* When to Answer */}
          <div id="sec-schedule" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.schedule} title={sec.schedule.title} subtitle={sec.schedule.subtitle}>
              <SettingsGroup>
                <SettingRow label={t('whenToAnswer.onlyDuringHours')} description={t('whenToAnswer.onlyDuringHoursDesc')}>
                  <Toggle checked={c.gating.businessHoursEnabled} onChange={() => setGating({ businessHoursEnabled: !c.gating.businessHoursEnabled })} />
                </SettingRow>
                <SettingRow label={t('whenToAnswer.ignoreFirst')} description={t('whenToAnswer.ignoreFirstDesc')}>
                  <Toggle checked={c.gating.ignoreFirstMessage} onChange={() => setGating({ ignoreFirstMessage: !c.gating.ignoreFirstMessage })} />
                </SettingRow>
              </SettingsGroup>
              {c.gating.businessHoursEnabled && (
                <Card>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('whenToAnswer.start')}>
                      <input type="time" value={c.gating.businessHoursStart} onChange={(e) => setGating({ businessHoursStart: e.target.value })} className="field tabular-nums" />
                    </Field>
                    <Field label={t('whenToAnswer.end')}>
                      <input type="time" value={c.gating.businessHoursEnd} onChange={(e) => setGating({ businessHoursEnd: e.target.value })} className="field tabular-nums" />
                    </Field>
                  </div>
                  <Field label={t('whenToAnswer.offHoursMessage')} hint={t('whenToAnswer.offHoursHint')}>
                    <TextArea value={c.gating.offHoursMessage} rows={2} placeholder={t('whenToAnswer.offHoursPlaceholder')} onChange={(v) => setGating({ offHoursMessage: v })} />
                  </Field>
                </Card>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('whenToAnswer.batchWindow')} hint={t('whenToAnswer.batchWindowHint')}>
                  <TextInput type="number" value={c.gating.batchWindowSeconds} className="max-w-[140px]" onChange={(v) => setGating({ batchWindowSeconds: Math.max(0, parseInt(v) || 0) })} />
                </Field>
                <Field label={t('whenToAnswer.maxReplies')} hint={t('whenToAnswer.maxRepliesHint')}>
                  <TextInput type="number" value={c.gating.maxResponsesPerHour} className="max-w-[140px]" onChange={(v) => setGating({ maxResponsesPerHour: parseInt(v) || 0 })} />
                </Field>
              </div>
              <Field label={t('whenToAnswer.fallback')} hint={t('whenToAnswer.fallbackHint')}>
                <TextArea value={c.gating.fallbackMessage} rows={2} onChange={(v) => setGating({ fallbackMessage: v })} />
              </Field>
              <MoreOptions label={t('whenToAnswer.limits')}>
                <Slider label={t('whenToAnswer.typingDelay')} value={c.gating.typingDelayMs} min={0} max={5000} step={100}
                  display={`${c.gating.typingDelayMs}ms`} icon={<Timer className="h-4 w-4 text-ink-4" />}
                  minLabel={t('whenToAnswer.typingDelayMin')} maxLabel={t('whenToAnswer.typingDelayMax')}
                  onChange={(v) => setGating({ typingDelayMs: Math.round(v) })} />
              </MoreOptions>
            </SectionCard>
          </div>

          {/* Human Handoff */}
          <div id="sec-handoff" className="scroll-mt-6">
            <SectionCard icon={SECTION_ICON.handoff} title={sec.handoff.title} subtitle={sec.handoff.subtitle}>
              <SettingsGroup>
                <SettingRow label={t('handoff.enable')}>
                  <Toggle checked={c.handoff.enabled} onChange={() => setHandoff({ enabled: !c.handoff.enabled })} />
                </SettingRow>
              </SettingsGroup>
              <div className={cn('space-y-5 transition-opacity', !c.handoff.enabled && 'opacity-50')}>
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink">{t('handoff.transferWhen')}</p>
                  <SettingsGroup className="sm:grid sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
                    <SettingRow label={t('handoff.complaint')}><Toggle checked={c.handoff.triggers.complaint} onChange={() => setHandoffTrig('complaint')} /></SettingRow>
                    <SettingRow label={t('handoff.refund')}><Toggle checked={c.handoff.triggers.refund} onChange={() => setHandoffTrig('refund')} /></SettingRow>
                    <SettingRow label={t('handoff.manager')}><Toggle checked={c.handoff.triggers.manager} onChange={() => setHandoffTrig('manager')} /></SettingRow>
                    <SettingRow label={t('handoff.humanAgent')}><Toggle checked={c.handoff.triggers.humanAgent} onChange={() => setHandoffTrig('humanAgent')} /></SettingRow>
                    <SettingRow label={t('handoff.technicalSupport')}><Toggle checked={c.handoff.triggers.technicalSupport} onChange={() => setHandoffTrig('technicalSupport')} /></SettingRow>
                  </SettingsGroup>
                </div>
                <Field label={t('handoff.customTriggers')}>
                  <TagListEditor items={c.handoff.customTriggers} onChange={(v) => setHandoff({ customTriggers: v })} placeholder={t('handoff.customTriggersPlaceholder')} numbered={false} />
                </Field>
                <Field label={t('handoff.transferMessage')} hint={t('handoff.transferMessageHint')}>
                  <TextArea value={c.handoff.transferMessage} rows={2} placeholder={t('handoff.transferMessagePlaceholder')} onChange={(v) => setHandoff({ transferMessage: v })} />
                </Field>
              </div>
              <Field label={t('whenToAnswer.pauseDuration')} hint={t('whenToAnswer.pauseDurationHint')}>
                <TextInput type="number" value={c.gating.pauseDurationHours} className="max-w-[140px]" onChange={(v) => setGating({ pauseDurationHours: parseInt(v) || 8 })} />
              </Field>
            </SectionCard>
          </div>

          {/* Connection */}
          <div id="sec-connection" className="scroll-mt-6">
            <SectionCard
              icon={SECTION_ICON.connection}
              title={sec.connection.title}
              subtitle={sec.connection.subtitle}
              badge={!hasApiKey && !hasGeminiKey ? <span className="chip chip-warn">{t('bot.connection.keyMissing')}</span> : undefined}
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field label={t('bot.connection.apiKey')} hint={t('bot.connection.apiKeyHint', { url: 'console.groq.com' })}>
                  {keyInput(apiKey, setApiKey, showApiKey, () => setShowApiKey((v) => !v), 'gsk_…')}
                  <p className={cn('flex items-center gap-1.5 text-2xs font-medium', hasApiKey ? 'text-brand' : 'text-amber-700 dark:text-amber-400')}>
                    <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {hasApiKey ? t('bot.connection.keySet') : t('bot.connection.keyMissing')}
                  </p>
                </Field>
                <Field label={t('bot.connection.geminiKey')} hint={t('bot.connection.geminiKeyHint', { url: 'aistudio.google.com/apikey' })}>
                  {keyInput(geminiApiKey, setGeminiApiKey, showGeminiKey, () => setShowGeminiKey((v) => !v), 'AIza… / AQ.…')}
                  <p className={cn('flex items-center gap-1.5 text-2xs font-medium', hasGeminiKey ? 'text-brand' : 'text-ink-3')}>
                    <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {hasGeminiKey ? t('bot.connection.geminiKeySet') : t('bot.connection.geminiKeyMissing')}
                  </p>
                </Field>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2.5">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
                <p className="text-xs leading-5 text-ink-2">{t('bot.connection.routingNote')}</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ModelAssignment routing={status?.routing ?? null} t={t} />
                <FreeTierMeter models={status?.models ?? []} geminiModels={status?.geminiModels ?? []} t={t} />
              </div>
            </SectionCard>
          </div>

          {/* Advanced */}
          <div id="sec-advanced" className="scroll-mt-6">
            <SectionCard
              icon={SECTION_ICON.advanced}
              title={sec.advanced.title}
              subtitle={sec.advanced.subtitle}
              badge={c.rawPromptOverride.trim() ? <span className="chip chip-warn">{t('bot.rawActive')}</span> : undefined}
            >
              <MoreOptions label={t('general.title')}>
                <Slider label={t('general.temperature')} value={c.general.temperature} min={0} max={1} step={0.1}
                  display={c.general.temperature.toFixed(1)} icon={<Thermometer className="h-4 w-4 text-ink-4" />}
                  hint={t('general.temperatureHint')} minLabel={t('general.temperatureMin')} maxLabel={t('general.temperatureMax')}
                  onChange={(v) => setGeneral({ temperature: v })} />
                <Slider label={t('general.creativity')} value={c.general.creativityLevel} min={0} max={1} step={0.1}
                  display={c.general.creativityLevel.toFixed(1)} icon={<Sparkles className="h-4 w-4 text-ink-4" />}
                  hint={t('general.creativityHint')} minLabel={t('general.creativityMin')} maxLabel={t('general.creativityMax')}
                  onChange={(v) => setGeneral({ creativityLevel: v })} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('general.maxTokens')} hint={t('general.maxTokensHint')}>
                    <TextInput type="number" value={c.general.maxTokens} className="max-w-[140px]" onChange={(v) => setGeneral({ maxTokens: parseInt(v) || 400 })} />
                  </Field>
                  <Field label={t('general.responseLength')}>
                    <SegmentedControl<ResponseLength>
                      value={c.general.responseLength}
                      onChange={(v) => setGeneral({ responseLength: v })}
                      options={[
                        { value: 'short',  label: t('general.lengthShort') },
                        { value: 'medium', label: t('general.lengthMedium') },
                        { value: 'long',   label: t('general.lengthLong') },
                      ]}
                    />
                  </Field>
                </div>
              </MoreOptions>

              <MoreOptions label={t('memory.title')}>
                <Slider label={t('memory.contextLength')} value={c.memory.contextLength} min={3} max={30} step={1}
                  display={`${c.memory.contextLength}`} icon={<Hash className="h-4 w-4 text-ink-4" />}
                  onChange={(v) => setMemory({ contextLength: Math.round(v) })} />
                <SettingsGroup>
                  <SettingRow label={t('memory.rememberName')}><Toggle checked={c.memory.rememberName} onChange={() => setMemory({ rememberName: !c.memory.rememberName })} /></SettingRow>
                  <SettingRow label={t('memory.rememberOrders')}><Toggle checked={c.memory.rememberOrders} onChange={() => setMemory({ rememberOrders: !c.memory.rememberOrders })} /></SettingRow>
                  <SettingRow label={t('memory.rememberPreferences')}><Toggle checked={c.memory.rememberPreferences} onChange={() => setMemory({ rememberPreferences: !c.memory.rememberPreferences })} /></SettingRow>
                  <SettingRow label={t('memory.persistent')} description={t('memory.persistentDesc')}><Toggle checked={c.memory.persistent} onChange={() => setMemory({ persistent: !c.memory.persistent })} /></SettingRow>
                </SettingsGroup>
              </MoreOptions>

              <MoreOptions label={t('variables.title')}>
                <div>
                  <SectionLabel>{t('variables.builtin')}</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {BUILTIN_VARIABLES.map((v) => (
                      <code key={v} className="rounded-md bg-raised px-2 py-1 font-mono text-xs text-brand ring-1 ring-inset ring-line">{v}</code>
                    ))}
                  </div>
                </div>
                <Field label={t('variables.custom')}>
                  <KeyValueEditor items={c.customVariables} onChange={(v) => update({ customVariables: v })} />
                  <p className="text-2xs text-ink-3">{t('variables.reference')} <code className="font-mono text-brand">{'{{your_key}}'}</code>.</p>
                </Field>
              </MoreOptions>

              <MoreOptions label={t('advanced.rawOverride')} defaultOpen={!!c.rawPromptOverride.trim()}>
                <p className="text-xs leading-5 text-ink-3">{t('advanced.rawOverrideHint')}</p>
                {c.rawPromptOverride.trim() && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t('advanced.activeWarning')}
                  </div>
                )}
                <TextArea value={c.rawPromptOverride} rows={10} showCount softLimit={8000} placeholder={t('advanced.rawOverridePlaceholder')} onChange={(v) => update({ rawPromptOverride: v })} />
              </MoreOptions>
            </SectionCard>
          </div>
        </div>

        {/* ── Test panel (docked on xl) ── */}
        <aside className="hidden xl:block">
          <div className="sticky top-6 space-y-3">
            <Playground config={c} isRTL={isRTL} t={t} />
            <p className="flex items-start gap-2 px-1 text-2xs leading-4 text-ink-3">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('bot.testNote')}
            </p>
          </div>
        </aside>
      </div>

      {/* ── Test panel as a drawer below xl ── */}
      <AnimatePresence>
        {testOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-[rgb(8_12_10/0.35)] xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTestOpen(false)} />
            <motion.div
              className="fixed inset-y-0 end-0 z-50 flex w-full flex-col bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] shadow-pop sm:w-[400px] xl:hidden"
              initial={{ x: isRTL ? '-100%' : '100%' }} animate={{ x: 0 }} exit={{ x: isRTL ? '-100%' : '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 42 }}
            >
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => setTestOpen(false)} className="btn btn-ghost btn-icon btn-sm" aria-label="Close"><X aria-hidden="true" /></button>
              </div>
              <div className="min-h-0 flex-1"><Playground config={c} isRTL={isRTL} t={t} fill /></div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── One save bar for the whole configuration ── */}
      <AnimatePresence>
        {(isDirty || saving || saved) && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="sticky bottom-[calc(var(--bottom-nav-space)+12px)] z-30 mx-auto mt-6 flex max-w-xl items-center gap-3 rounded-xl bg-nav px-4 py-2.5 text-nav-ink shadow-pop sm:bottom-5"
            role="status"
          >
            {saved && !isDirty ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                <p className="flex-1 text-[13px] font-medium">{t('bot.allSaved')}</p>
              </>
            ) : (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{t('bot.unsaved')}</p>
                  <p className="hidden truncate text-2xs text-nav-muted sm:block">{t('bot.unsavedBody')}</p>
                </div>
                <button type="button" onClick={() => { setLoading(true); void load(); }} disabled={saving} className="btn btn-sm text-nav-muted hover:bg-nav-hover hover:text-nav-ink">
                  {t('bot.discard')}
                </button>
                <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? <RotateCcw className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                  {saving ? t('bot.saving') : t('bot.save')}
                  <kbd className="ms-1 hidden rounded bg-black/15 px-1 font-mono text-[10px] sm:inline">⌘S</kbd>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {showTemplates && <TemplatesModal onApply={applyTemplate} onClose={() => setShowTemplates(false)} isRTL={isRTL} />}
    </div>
  );
}

// ── Which model each feature uses (read from the router) ─────────────────────
function ModelAssignment({ routing, t }: { routing: RoutingMap | null; t: (k: string) => string }) {
  const rows: Array<{ key: keyof RoutingMap; label: string }> = [
    { key: 'bot', label: t('bot.routing.bot') },
    { key: 'qualification', label: t('bot.routing.qualification') },
    { key: 'assistant', label: t('bot.routing.assistant') },
  ];
  return (
    <div className="rounded-lg border border-line">
      <p className="border-b border-line px-3.5 py-2.5 text-[13px] font-medium text-ink">{t('bot.routing.title')}</p>
      <div className="divide-y divide-line">
        {rows.map((r) => {
          const chain = routing?.[r.key] ?? [];
          return (
            <div key={r.key} className="flex flex-col gap-1.5 px-3.5 py-2.5">
              <span className="text-xs text-ink-3">{r.label}</span>
              <div className="flex flex-wrap items-center gap-1">
                {chain.length === 0
                  ? <span className="text-xs text-ink-4">—</span>
                  : chain.map((cand, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-ink-4 icon-mirror" />}
                        <span className={cn('chip', i === 0 ? 'chip-brand' : 'chip-neutral')}>{modelLabel(cand.model)}</span>
                      </span>
                    ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-line px-3.5 py-2 text-2xs leading-4 text-ink-3">{t('bot.routing.hint')}</p>
    </div>
  );
}

// ── Live free-tier usage meter (Gemini + Groq buckets) ───────────────────────
function FreeTierMeter({ models, geminiModels, t }: {
  models: GroqModelStatus[]; geminiModels: GeminiModelStatus[]; t: (k: string) => string;
}) {
  if (models.length === 0 && geminiModels.length === 0) return null;
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Gauge className="h-4 w-4 text-ink-4" aria-hidden="true" />
        <p className="text-[13px] font-medium text-ink">{t('bot.usage.title')}</p>
      </div>
      <div className="space-y-3 px-3.5 py-3">
        {geminiModels.map((m) => (
          <div key={m.model} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-ink-2">{modelLabel(m.model)}</span>
            {!m.available
              ? <span dir="ltr" className="font-medium tabular-nums text-amber-600">{Math.floor(m.secondsLeft / 60)}:{String(m.secondsLeft % 60).padStart(2, '0')}</span>
              : <span className="text-ink-3"><span className="font-semibold tabular-nums text-ink">{m.requestsToday}</span> {t('bot.usage.today')}</span>}
          </div>
        ))}
        {models.map((m) => {
          const q = m.quota;
          const tokPct = q && q.remainingTokens != null && q.limitTokens ? Math.max(0, Math.min(1, q.remainingTokens / q.limitTokens)) : null;
          const low = tokPct != null && tokPct <= 0.15;
          const mid = tokPct != null && tokPct > 0.15 && tokPct <= 0.4;
          return (
            <div key={m.model} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink-2">{modelLabel(m.model)}</span>
                {!m.available
                  ? <span dir="ltr" className="font-medium tabular-nums text-amber-600">{Math.floor(m.secondsLeft / 60)}:{String(m.secondsLeft % 60).padStart(2, '0')}</span>
                  : q
                  ? <span dir="ltr" className="tabular-nums text-ink-3">{fmtNum(q.remainingTokens)}/{fmtNum(q.limitTokens)} {t('bot.usage.tok')}</span>
                  : <span className="text-ink-4">{t('bot.usage.idle')}</span>}
              </div>
              {tokPct != null && (
                <div className="h-1 overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line">
                  <div className={cn('grow-x h-1 rounded-full', low ? 'bg-red-500' : mid ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${Math.round(tokPct * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Live test playground ─────────────────────────────────────────────────────
function Playground({ config, isRTL, t, fill }: { config: AiConfig; isRTL: boolean; t: (k: string) => string; fill?: boolean }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true); setErr('');
    const next = [...history, { role: 'user' as const, content: text }];
    setHistory(next); setMessage('');
    try {
      const data = await api.post('/api/chatbot/ai-config/playground', { config, message: text, history });
      setHistory([...next, { role: 'assistant', content: data.reply }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('playground.error'));
    } finally {
      setBusy(false);
    }
  };

  const SAMPLES = [
    'Hello! What do you offer?',
    'How much does it cost?',
    'I want to place an order',
    'Can I speak to someone?',
  ];

  return (
    <div className={cn('panel flex flex-col overflow-hidden', fill && 'h-full')}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-brand" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-ink">{t('bot.test')}</span>
          <span className="hidden text-2xs text-ink-3 sm:inline">· {t('bot.testLive')}</span>
        </div>
        {history.length > 0 && (
          <button type="button" title="Clear" onClick={() => setHistory([])} className="btn btn-ghost btn-icon btn-sm" aria-label="Clear">
            <RotateCcw aria-hidden="true" />
          </button>
        )}
      </div>

      <div className={cn('relative flex-1 space-y-2 overflow-y-auto bg-chat p-3', fill ? 'min-h-0' : 'h-[440px]')} dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="chat-doodle pointer-events-none absolute inset-0" aria-hidden="true" />
        {history.length === 0 ? (
          <div className="relative flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-brand shadow-soft ring-1 ring-line">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink">{t('bot.testEmptyTitle')}</p>
              <p className="mt-1 text-xs text-ink-3">{t('bot.testEmptySub')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => setMessage(q)}
                  className="rounded-full bg-surface px-3 py-1.5 text-xs text-ink-2 shadow-soft ring-1 ring-line transition-colors hover:text-ink">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          history.map((m, i) => (
            <div key={i} className={cn('relative flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('pop-enter max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed text-ink shadow-[0_1px_0.5px_rgb(11_20_16/0.1)]', m.role === 'user' ? 'bg-bubble-out' : 'bg-bubble-in')} dir="auto">
                {m.content}
              </div>
            </div>
          ))
        )}
        {busy && (
          <div className="relative flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-bubble-in px-3 py-2 shadow-soft">
              <span className="inline-flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:300ms]" />
              </span>
              <span className="text-xs text-ink-3">{t('playground.thinking')}</span>
            </div>
          </div>
        )}
        {err && <p className="relative text-center text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-line p-2.5">
        <input
          value={message}
          dir="auto"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(); }}
          placeholder={t('bot.testPlaceholder')}
          className="field flex-1 rounded-full bg-raised border-transparent"
        />
        <button type="button" onClick={send} disabled={busy || !message.trim()} className="btn btn-primary btn-icon rounded-full" aria-label="Send">
          <Send className="icon-mirror" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
