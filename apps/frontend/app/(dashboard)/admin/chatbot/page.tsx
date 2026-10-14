'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useDirection } from '@/hooks/useDirection';
import {
  Eye, EyeOff, Save, RotateCcw, CheckCircle2, AlertCircle, MessageSquare, Brain,
  Thermometer, ChevronRight, Target, KeyRound, CheckCircle, XCircle, Timer, Layers, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isManager } from '@/lib/roles';
import { PageHeader } from '@/components/ui/page';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toggle, SettingRow, SettingsGroup, Field, TextArea, Slider, TextInput } from '@/components/ai-config/primitives';

type Section = 'overview' | 'crmAssistant' | 'leadQualification';
type Provider = 'groq' | 'openai' | 'anthropic';

interface AiStatus {
  provider: Provider;
  hasApiKey: boolean;
  customerBot: { enabled: boolean; replyToAll: boolean; targetingMode: 'all' | 'rules'; model: string };
  crmAssistant: { enabled: boolean; model: string };
  leadQualification: { enabled: boolean; model: string; debounceSeconds: number };
  models: Array<{
    model: string;
    available: boolean;
    secondsLeft: number;
    primary: boolean;
    quota: {
      remainingRequests: number | null;
      limitRequests: number | null;
      remainingTokens: number | null;
      limitTokens: number | null;
      resetRequests: string | null;
      resetTokens: string | null;
      updatedAt: number;
    } | null;
  }>;
}

interface ChatbotSettings {
  enabled: boolean;
  replyToAllConversations: boolean;
  provider: Provider;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  pauseOnHumanReply: boolean;
  pauseDurationHours: number;
  contextWindow: number;
  fallbackMessage: string;
  typingDelayMs: number;
  ignoreFirstMessage: boolean;
  maxResponsesPerHour: number;
  businessHoursEnabled: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  offHoursMessage: string;
  escalationKeywords: string;
  escalationMessage: string;
  // crm assistant
  crmAssistantEnabled: boolean;
  crmAssistantUseSameProvider: boolean;
  crmAssistantApiKey: string;
  crmAssistantModel: string;
  crmAssistantSystemPrompt: string;
  // lead qualification
  qualificationEnabled: boolean;
  qualificationModel: string;
  qualificationSystemPrompt: string;
  qualificationTemperature: number;
  qualificationDebounceMs: number;
  qualificationContextWindow: number;
}

const MODEL_OPTIONS: Record<Provider, Array<{ value: string; label: string; badge?: string }>> = {
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', badge: 'Versatile' },
    { value: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B',  badge: 'Fast' },
    { value: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B',  badge: '32k' },
    { value: 'mistral-saba-24b',         label: 'Mistral Saba',  badge: 'Arabic' },
  ],
  openai: [
    { value: 'gpt-4o',       label: 'GPT-4o',       badge: 'Latest' },
    { value: 'gpt-4o-mini',  label: 'GPT-4o Mini',  badge: 'Fast' },
    { value: 'gpt-4-turbo',  label: 'GPT-4 Turbo',  badge: '' },
    { value: 'gpt-3.5-turbo',label: 'GPT-3.5 Turbo',badge: 'Legacy' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6', badge: 'Balanced' },
    { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5',  badge: 'Fast' },
    { value: 'claude-opus-4-7',            label: 'Claude Opus 4.7',   badge: 'Powerful' },
  ],
};

const PROVIDER_KEY_URLS: Record<Provider, string> = {
  groq:      'console.groq.com',
  openai:    'platform.openai.com/api-keys',
  anthropic: 'console.anthropic.com',
};

// Compact number: 14400 → "14.4k", 1200000 → "1.2M".
function fmtQuota(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

/** One live quota meter (requests or tokens) for a model, from Groq's headers. */
function QuotaStat({ label, remaining, limit, reset, resetLabel }: {
  label: string;
  remaining: number | null;
  limit: number | null;
  reset: string | null;
  resetLabel: string;
}) {
  const pct = remaining != null && limit ? Math.max(0, Math.min(1, remaining / limit)) : null;
  const low = pct != null && pct <= 0.15;
  const mid = pct != null && pct > 0.15 && pct <= 0.4;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-2xs text-ink-3">
        <span className="truncate">{label}</span>
        {reset && <span dir="ltr" className="tabular-nums text-ink-4" title={`${resetLabel} ${reset}`}>{reset}</span>}
      </div>
      <p className="mt-0.5 text-xs">
        <span dir="ltr" className={cn('font-semibold tabular-nums', low ? 'text-red-600 dark:text-red-400' : mid ? 'text-amber-700 dark:text-amber-400' : 'text-ink')}>{fmtQuota(remaining)}</span>
        <span dir="ltr" className="tabular-nums text-ink-4"> / {fmtQuota(limit)}</span>
      </p>
      {pct != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line">
          <div className={cn('grow-x h-1 rounded-full', low ? 'bg-red-500' : mid ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * AI settings shared by every AI feature: the provider and key, the CRM
 * assistant, and lead qualification. The customer-facing bot has its own
 * screen (AI Agent); this page links there instead of duplicating it.
 */
export default function ChatbotAdminPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const { t } = useTranslation('admin');
  const { isRTL } = useDirection();

  const role    = (session?.user as { role?: string } | undefined)?.role ?? 'AGENT';
  const isAdmin = isManager(role);

  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [settings, setSettings]           = useState<ChatbotSettings | null>(null);
  const [status, setStatus]               = useState<AiStatus | null>(null);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [dirty, setDirty]                 = useState(false);
  const [error, setError]                 = useState('');
  const [showApiKey, setShowApiKey]       = useState(false);
  const [showCrmApiKey, setShowCrmApiKey] = useState(false);

  const fetchStatus = useCallback(async () => {
    try { setStatus(await api.get('/api/chatbot/status')); } catch { /* non-fatal */ }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.get('/api/chatbot/settings');
      setSettings(data);
      setDirty(false);
      void fetchStatus();
    } catch {
      setError(t('chatbot.accessDenied'));
    } finally {
      setLoading(false);
    }
  }, [t, fetchStatus]);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!isAdmin) { router.replace('/dashboard'); return; }
    fetchSettings();
  }, [sessionStatus, isAdmin, fetchSettings, router]);

  // Keep the live model quota fresh while the page is open so it can be tracked.
  useEffect(() => {
    if (!isAdmin) return;
    const id = setInterval(() => { void fetchStatus(); }, 20000);
    return () => clearInterval(id);
  }, [isAdmin, fetchStatus]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const data = await api.put('/api/chatbot/settings', settings);
      setSettings(data);
      setDirty(false);
      void fetchStatus();
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chatbot.accessDenied'));
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<ChatbotSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  if (sessionStatus === 'loading' || loading) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading AI settings">
        <div className="space-y-2"><Skeleton className="h-6 w-44 rounded" /><Skeleton className="h-3.5 w-80 max-w-full rounded" /></div>
        <Skeleton className="h-9 w-80 rounded-lg" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const tabs: { id: Section; icon: React.ElementType; label: string; on?: boolean }[] = [
    { id: 'overview', icon: Cpu, label: t('chatbot.tabs.overview') },
    { id: 'crmAssistant', icon: Brain, label: t('chatbot.tabs.crmAssistant'), on: settings?.crmAssistantEnabled },
    { id: 'leadQualification', icon: Target, label: t('chatbot.tabs.leadQualification'), on: settings?.qualificationEnabled },
  ];

  const selectCls = 'field appearance-none';

  const keyField = (value: string, onChange: (v: string) => void, shown: boolean, toggle: () => void, placeholder: string) => (
    <div className="relative">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        autoComplete="off"
        className="field pe-10 font-mono text-xs"
      />
      <button type="button" onClick={toggle} className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink" aria-label={shown ? 'Hide key' : 'Show key'}>
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );

  // ── Overview ───────────────────────────────────────────────────────────────
  function OverviewSection() {
    if (!settings) return null;
    const botEnabled = status?.customerBot.enabled ?? false;
    const features = [
      {
        key: 'leadQualification' as const, icon: Target, label: t('chatbot.tabs.leadQualification'), on: settings.qualificationEnabled,
        meta: `${settings.qualificationModel} · ${Math.round((settings.qualificationDebounceMs || 45000) / 1000)}s`,
      },
      {
        key: 'crmAssistant' as const, icon: Brain, label: t('chatbot.tabs.crmAssistant'), on: settings.crmAssistantEnabled,
        meta: settings.crmAssistantUseSameProvider ? settings.model : settings.crmAssistantModel,
      },
    ];
    return (
      <div className="space-y-5">
        {/* The customer bot has its own screen — link out, don't duplicate. */}
        <Link href="/admin/customer-ai" className="panel lift group flex items-center gap-4 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-ink">{t('chatbot.tabs.customerBot')}</p>
              <span className={cn('chip', botEnabled ? 'chip-brand' : 'chip-neutral')}>
                {botEnabled ? t('chatbot.status.enabled') : t('chatbot.status.disabled')}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-3">{t('chatbot.customerBot.description')}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-2 group-hover:text-ink">
            {t('chatbot.overview.manage')} <ChevronRight className="h-3.5 w-3.5 icon-mirror" />
          </span>
        </Link>

        {/* Shared connection */}
        <section className="panel">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-semibold text-ink">{t('chatbot.provider.title')}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{t('chatbot.connection.note')}</p>
          </header>
          <div className="space-y-5 p-5">
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('chatbot.provider.title')}>
              {(['groq', 'openai', 'anthropic'] as Provider[]).map((p) => {
                const on = settings.provider === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => update({ provider: p, model: MODEL_OPTIONS[p][0].value })}
                    className={cn(
                      'flex items-start justify-between gap-2 rounded-lg border p-3 text-start transition-colors',
                      on ? 'border-brand bg-brand/[0.05] ring-1 ring-inset ring-brand/40' : 'border-line hover:border-line-strong hover:bg-raised/50',
                    )}
                  >
                    <span>
                      <span className="block text-[13px] font-semibold text-ink">{t(`chatbot.provider.${p}`)}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{t(`chatbot.provider.${p}Desc`)}</span>
                    </span>
                    <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-brand bg-brand' : 'border-line-strong')}>
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-brand-fg" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <Field label={t('chatbot.apiKey')} hint={t('chatbot.apiKeyLink', { url: PROVIDER_KEY_URLS[settings.provider] })}>
              {keyField(settings.apiKey, (v) => update({ apiKey: v }), showApiKey, () => setShowApiKey((v) => !v), `${settings.provider} API key`)}
              <p className={cn('flex items-center gap-1.5 text-2xs font-medium', status?.hasApiKey ? 'text-brand' : 'text-amber-700 dark:text-amber-400')}>
                {status?.hasApiKey ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {status?.hasApiKey ? t('chatbot.overview.keySet') : t('chatbot.overview.keyMissing')}
              </p>
            </Field>
          </div>
        </section>

        {/* Features */}
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <button key={f.key} type="button" onClick={() => setActiveSection(f.key)} className="panel lift group flex items-center gap-3 p-4 text-start">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-2 ring-1 ring-inset ring-line">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{f.label}</span>
                    <span className={cn('chip', f.on ? 'chip-brand' : 'chip-neutral')}>{f.on ? t('chatbot.status.enabled') : t('chatbot.status.disabled')}</span>
                  </span>
                  <span dir="ltr" className="mt-0.5 block truncate text-start font-mono text-2xs text-ink-3">{f.meta}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 icon-mirror" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {/* Failover quota */}
        {status && status.provider === 'groq' && status.models.length > 0 && (
          <section className="panel">
            <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <Cpu className="h-4 w-4 text-ink-4" aria-hidden="true" />
              <h2 className="text-[13px] font-semibold text-ink">{t('chatbot.overview.failover')}</h2>
            </header>
            <ul className="divide-y divide-line">
              {status.models.map((m) => {
                const q = m.quota;
                return (
                  <li key={m.model} className="grid gap-3 px-5 py-3 sm:grid-cols-[1fr_160px_160px] sm:items-center">
                    <div className="flex min-w-0 items-center gap-2">
                      <span dir="ltr" className="truncate font-mono text-xs text-ink">{m.model}</span>
                      {m.primary && <span className="chip chip-neutral">{t('chatbot.overview.primary')}</span>}
                      {!m.available
                        ? <span dir="ltr" className="chip chip-warn"><Timer className="h-3 w-3" /> {Math.floor(m.secondsLeft / 60)}:{String(m.secondsLeft % 60).padStart(2, '0')}</span>
                        : <span className="chip chip-brand">{t('chatbot.overview.ready')}</span>}
                    </div>
                    {q ? (
                      <>
                        <QuotaStat label={t('chatbot.overview.requests')} resetLabel={t('chatbot.overview.resetsIn')} remaining={q.remainingRequests} limit={q.limitRequests} reset={q.resetRequests} />
                        <QuotaStat label={t('chatbot.overview.tokens')} resetLabel={t('chatbot.overview.resetsIn')} remaining={q.remainingTokens} limit={q.limitTokens} reset={q.resetTokens} />
                      </>
                    ) : (
                      <p className="text-2xs text-ink-4 sm:col-span-2">{t('chatbot.overview.noQuotaData')}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-5 py-2.5 text-2xs leading-4 text-ink-3">{t('chatbot.overview.failoverHint')}</p>
          </section>
        )}
      </div>
    );
  }

  // ── CRM Assistant ──────────────────────────────────────────────────────────
  function CrmAssistantSection() {
    if (!settings) return null;
    return (
      <div className="space-y-5">
        <SettingsGroup className="bg-surface">
          <SettingRow label={t('chatbot.crmAssistant.enable')} description={t('chatbot.crmAssistant.enableDesc')}>
            <Toggle checked={settings.crmAssistantEnabled} onChange={() => update({ crmAssistantEnabled: !settings.crmAssistantEnabled })} />
          </SettingRow>
          <SettingRow label={t('chatbot.crmAssistant.sameProvider')} description={t('chatbot.crmAssistant.sameProviderDesc')}>
            <Toggle checked={settings.crmAssistantUseSameProvider} onChange={() => update({ crmAssistantUseSameProvider: !settings.crmAssistantUseSameProvider })} />
          </SettingRow>
        </SettingsGroup>

        {!settings.crmAssistantUseSameProvider && (
          <section className="panel space-y-5 p-5">
            <div>
              <h3 className="text-[13px] font-semibold text-ink">{t('chatbot.separateConfig')}</h3>
              <p className="mt-0.5 text-xs text-ink-3">{t('chatbot.separateConfigDesc')}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('chatbot.model')}>
                <select value={settings.crmAssistantModel} onChange={(e) => update({ crmAssistantModel: e.target.value })} className={selectCls}>
                  {MODEL_OPTIONS[settings.provider].map((m) => (
                    <option key={m.value} value={m.value}>{m.label}{m.badge ? ` — ${m.badge}` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('chatbot.apiKey')}>
                {keyField(settings.crmAssistantApiKey, (v) => update({ crmAssistantApiKey: v }), showCrmApiKey, () => setShowCrmApiKey((v) => !v), t('chatbot.crmApiKeyPlaceholder'))}
              </Field>
            </div>
          </section>
        )}

        <section className="panel space-y-2 p-5">
          <Field label={t('chatbot.systemPrompt')} hint={t('chatbot.crmSystemPromptDesc')}>
            <TextArea value={settings.crmAssistantSystemPrompt} onChange={(v) => update({ crmAssistantSystemPrompt: v })} rows={12} showCount softLimit={6000} placeholder={t('chatbot.crmSystemPromptPlaceholder')} />
          </Field>
        </section>
      </div>
    );
  }

  // ── Lead Qualification ─────────────────────────────────────────────────────
  function LeadQualificationSection() {
    if (!settings) return null;
    const debounceSeconds = Math.round((settings.qualificationDebounceMs || 45000) / 1000);
    return (
      <div className="space-y-5">
        <SettingsGroup className="bg-surface">
          <SettingRow label={t('chatbot.leadQualification.enable')} description={t('chatbot.leadQualification.enableDesc')}>
            <Toggle checked={settings.qualificationEnabled} onChange={() => update({ qualificationEnabled: !settings.qualificationEnabled })} />
          </SettingRow>
        </SettingsGroup>

        <p className="flex items-start gap-2 px-1 text-xs leading-5 text-ink-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('chatbot.leadQualification.providerNote')}
        </p>

        <section className="panel space-y-6 p-5">
          <h3 className="text-[13px] font-semibold text-ink">{t('chatbot.tuning')}</h3>
          <Field label={t('chatbot.leadQualification.model')} hint={t('chatbot.leadQualification.modelDesc')}>
            <select value={settings.qualificationModel} onChange={(e) => update({ qualificationModel: e.target.value })} className={cn(selectCls, 'max-w-sm')}>
              {MODEL_OPTIONS[settings.provider].map((m) => (
                <option key={m.value} value={m.value}>{m.label}{m.badge ? ` — ${m.badge}` : ''}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-6 md:grid-cols-2">
            <Slider
              label={t('chatbot.leadQualification.temperature')}
              hint={t('chatbot.leadQualification.temperatureDesc')}
              icon={<Thermometer className="h-4 w-4 text-ink-4" />}
              value={settings.qualificationTemperature} min={0} max={1} step={0.1}
              display={settings.qualificationTemperature.toFixed(1)}
              onChange={(v) => update({ qualificationTemperature: v })}
            />
            <Slider
              label={t('chatbot.leadQualification.contextWindow')}
              hint={t('chatbot.leadQualification.contextWindowDesc')}
              icon={<Layers className="h-4 w-4 text-ink-4" />}
              value={settings.qualificationContextWindow} min={4} max={30} step={1}
              display={String(settings.qualificationContextWindow)}
              onChange={(v) => update({ qualificationContextWindow: Math.round(v) })}
            />
          </div>
          <Field label={t('chatbot.leadQualification.debounce')} hint={t('chatbot.leadQualification.debounceDesc')}>
            <TextInput type="number" value={debounceSeconds} className="max-w-[140px]" onChange={(v) => update({ qualificationDebounceMs: (parseInt(v) || 45) * 1000 })} />
          </Field>
        </section>

        <section className="panel p-5">
          <Field label={t('chatbot.leadQualification.systemPrompt')} hint={t('chatbot.leadQualification.systemPromptDesc')}>
            <TextArea value={settings.qualificationSystemPrompt} onChange={(v) => update({ qualificationSystemPrompt: v })} rows={12} showCount softLimit={6000} placeholder={t('chatbot.leadQualification.systemPromptPlaceholder')} />
          </Field>
        </section>
      </div>
    );
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('chatbot.title')}
        description={t('chatbot.subtitle')}
        meta={settings && (
          <span className={cn('chip', status?.customerBot.enabled ? 'chip-brand' : 'chip-neutral')}>
            {t('chatbot.tabs.customerBot')} · {status?.customerBot.enabled ? t('chatbot.status.enabled') : t('chatbot.status.disabled')}
          </span>
        )}
      />

      {!settings && !loading && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/25 dark:bg-red-500/10">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-[13px] text-red-700 dark:text-red-300">{t('chatbot.accessDenied')}</p>
        </div>
      )}

      {settings && (
        <>
          {/* Tabs — the underline glides between them */}
          <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line scrollbar-none" role="tablist">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveSection(tab.id)}
                  className={cn('relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-[13px] font-medium transition-colors', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-brand' : 'text-ink-4')} aria-hidden="true" />
                  {tab.label}
                  {tab.on !== undefined && <span className={cn('h-1.5 w-1.5 rounded-full', tab.on ? 'bg-brand' : 'bg-line-strong')} aria-hidden="true" />}
                  {active && <motion.span layoutId="ai-settings-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                </button>
              );
            })}
          </div>

          <div className="max-w-4xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Called, not mounted: as <Component/> these would remount on every
                    keystroke (they are re-declared each render) and drop input focus. */}
                {activeSection === 'overview' && OverviewSection()}
                {activeSection === 'crmAssistant' && CrmAssistantSection()}
                {activeSection === 'leadQualification' && LeadQualificationSection()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* One save bar for every setting on this page */}
          <AnimatePresence>
            {(dirty || saving || saved || error) && (
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="sticky bottom-[calc(var(--bottom-nav-space)+12px)] z-30 mx-auto mt-6 flex max-w-xl items-center gap-3 rounded-xl bg-nav px-4 py-2.5 text-nav-ink shadow-pop sm:bottom-5"
                role="status"
              >
                {error ? (
                  <>
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                    <p className="min-w-0 flex-1 truncate text-[13px]">{error}</p>
                  </>
                ) : saved && !dirty ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                    <p className="flex-1 text-[13px] font-medium">{t('chatbot.saved')}</p>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                    <p className="flex-1 text-[13px] font-medium">{t('chatbot.unsaved', { defaultValue: 'Unsaved changes' })}</p>
                    <button type="button" onClick={() => { setLoading(true); void fetchSettings(); }} disabled={saving} className="btn btn-sm text-nav-muted hover:bg-nav-hover hover:text-nav-ink">
                      {t('chatbot.discard', { defaultValue: 'Discard' })}
                    </button>
                  </>
                )}
                {(dirty || error) && (
                  <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
                    {saving ? <RotateCcw className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                    {saving ? t('chatbot.saving') : t('chatbot.save')}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
