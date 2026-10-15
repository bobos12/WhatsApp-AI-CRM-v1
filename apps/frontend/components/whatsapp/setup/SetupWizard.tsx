'use client';

/**
 * Connect a WhatsApp number in three steps: paste two values from Meta, pick a
 * number from the ones Meta lists, and watch the CRM wire everything up.
 *
 * The old flow asked for five values from four Meta screens and a webhook set
 * up by hand, and most failures surfaced days later as a send that silently
 * didn't. Here the server discovers what it can, does the wiring itself, and
 * every remaining problem is shown with its fix in place — moving the number
 * with its PIN, pasting the webhook by hand, adding a card in Meta.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, Eye, EyeOff, Loader2, PartyPopper, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { META_LINKS, Notice, StatusIcon, TOKEN_PERMISSIONS, errorText, type RowStatus } from './shared';
import { ManualWebhookCard, PaymentCard, RegisterNumberCard } from './FixCards';

type Step = 'credentials' | 'number' | 'finish';
const STEPS: Step[] = ['credentials', 'number', 'finish'];

interface DiscoveredNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  status: string | null;
  wabaId: string | null;
  canSend: boolean | null;
  issues: { code: string; message: string }[];
  isTestNumber: boolean;
}

interface ConnectStep {
  id: 'verify' | 'subscribe' | 'webhook' | 'sending' | 'account';
  status: 'ok' | 'warn' | 'fail';
  code: string;
  detail?: string;
}

const ROW_ORDER: ConnectStep['id'][] = ['verify', 'subscribe', 'webhook', 'sending', 'account'];

export interface SetupWizardProps {
  /** A stored connection exists, so blank secrets mean "keep the saved ones". */
  hasStoredCredentials?: boolean;
  /** Fired before the connect request, so the host keeps this screen up while it runs. */
  onConnecting?: () => void;
  /** The user is done here — show them the CRM. */
  onFinish: () => void;
  onCancel?: () => void;
}

export default function SetupWizard({ hasStoredCredentials, onConnecting, onFinish, onCancel }: SetupWizardProps) {
  const { t } = useTranslation('whatsapp');
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<Step>('credentials');

  // ── Step 1 ──
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [needsBusiness, setNeedsBusiness] = useState(false);
  // Open by default on a wide screen for a first-time setup. On a phone it would
  // push the two fields a full screen down, so there it stays one tap away.
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (!hasStoredCredentials && window.matchMedia('(min-width: 640px)').matches) setGuideOpen(true);
  }, [hasStoredCredentials]);
  const [discovering, setDiscovering] = useState(false);
  const [credError, setCredError] = useState<{ text: string; field?: 'token' | 'secret' | 'business' } | null>(null);
  const credErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (credError) credErrorRef.current?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [credError, reduceMotion]);

  // ── Step 2 ──
  const [numbers, setNumbers] = useState<DiscoveredNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // ── Step 3 ──
  const [connecting, setConnecting] = useState(false);
  const [results, setResults] = useState<ConnectStep[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [manualWebhook, setManualWebhook] = useState<{ callbackUrl: string | null; verifyToken: string | null } | null>(null);

  const tokenLooksWrong = token.trim().length > 10 && !token.trim().startsWith('EAA');
  const secretLooksWrong = secret.trim().length > 0 && !/^[a-f0-9]{32}$/i.test(secret.trim());
  const canDiscover = (token.trim() || hasStoredCredentials) && (secret.trim() || hasStoredCredentials) && (!needsBusiness || /^\d+$/.test(businessId.trim()));

  const discover = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canDiscover || discovering) return;
    setDiscovering(true);
    setCredError(null);
    setGuideOpen(false);
    try {
      const res = await api.post('/api/channel/discover', {
        accessToken: token.trim() || undefined,
        appSecret: secret.trim() || null,
        businessId: businessId.trim() || null,
      });
      if (res.needsBusinessId) {
        setNeedsBusiness(true);
        return;
      }
      const list: DiscoveredNumber[] = res.numbers ?? [];
      setNumbers(list);
      const best = list.find((n) => n.status === 'CONNECTED' && n.canSend !== false && !n.isTestNumber) ?? list.find((n) => n.status === 'CONNECTED');
      setSelected(best?.phoneNumberId ?? null);
      setStep('number');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setCredError({
        text: errorText(t, err),
        field: code?.startsWith('APP_SECRET') ? 'secret' : code === 'VALIDATION_ERROR' && needsBusiness ? 'business' : code?.startsWith('TOKEN') ? 'token' : undefined,
      });
    } finally {
      setDiscovering(false);
    }
  };

  const chosen = numbers.find((n) => n.phoneNumberId === selected) ?? null;

  const connect = async () => {
    if (!chosen) return;
    onConnecting?.();
    setStep('finish');
    setConnecting(true);
    setResults(null);
    setRevealed(0);
    setConnectError(null);
    setManualWebhook(null);
    try {
      const res = await api.post('/api/channel/connect', {
        phoneNumberId: chosen.phoneNumberId,
        accessToken: token.trim() || undefined,
        appSecret: secret.trim() || null,
      });
      const ordered = [...(res.steps as ConnectStep[])].sort((a, b) => ROW_ORDER.indexOf(a.id) - ROW_ORDER.indexOf(b.id));
      setResults(ordered);
      setManualWebhook(res.manualWebhook ?? null);
    } catch (err) {
      setConnectError(errorText(t, err));
    } finally {
      setConnecting(false);
    }
  };

  // Results arrive at once; revealing them row by row lets the eye follow what
  // was checked instead of being handed a finished list.
  useEffect(() => {
    if (!results || revealed >= results.length) return;
    const timer = setTimeout(() => setRevealed((r) => r + 1), reduceMotion ? 0 : 420);
    return () => clearTimeout(timer);
  }, [results, revealed, reduceMotion]);

  const markFixed = (id: ConnectStep['id']) =>
    setResults((rs) => rs?.map((r) => (r.id === id ? { ...r, status: 'ok' } : r)) ?? rs);

  const allRevealed = results != null && revealed >= results.length;
  const failedVerify = results?.find((r) => r.id === 'verify' && r.status === 'fail');
  // Failures block "you're live"; a missing card does too, since templates and
  // campaigns stop. Softer warnings stay visible on their row only.
  const openIssues = results?.filter((r) => r.status === 'fail' || r.code === 'PAYMENT_METHOD') ?? [];

  const stepIndex = STEPS.indexOf(step);
  const finished = allRevealed && !failedVerify && !connectError;
  const slide = reduceMotion
    ? {}
    : { initial: { opacity: 0, x: 14 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -10 }, transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const } };

  return (
    <div className="flex flex-col">
      <Stepper current={finished ? STEPS.length : stepIndex} labels={STEPS.map((s) => t(`setup.steps.${s}`))} stepOf={t('setup.stepOf', { n: Math.min(stepIndex + 1, STEPS.length) })} />

      <AnimatePresence mode="wait" initial={false}>
        {/* ── 1 · Credentials ─────────────────────────────────────────────── */}
        {step === 'credentials' && (
          <motion.form key="credentials" {...slide} onSubmit={discover} className="mt-6 flex flex-col gap-5" noValidate>
            <header>
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{t('setup.credentials.title')}</h2>
              <p className="mt-1 text-[13px] leading-5 text-ink-3">{t('setup.credentials.body')}</p>
            </header>

            <Guide open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />

            <div>
              <label htmlFor="wa-token" className="label">{t('setup.credentials.token')}</label>
              <div className="relative">
                <input
                  id="wa-token"
                  dir="ltr"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={hasStoredCredentials ? t('setup.credentials.keepSaved') : 'EAA…'}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={credError?.field === 'token'}
                  aria-describedby="wa-token-hint"
                  className={cn('field pe-16 font-mono text-xs', credError?.field === 'token' && 'border-red-400 focus:border-red-400 focus:ring-red-500/15')}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="btn btn-ghost btn-sm absolute end-1 top-1/2 -translate-y-1/2"
                  aria-label={showToken ? t('setup.credentials.hide') : t('setup.credentials.show')}
                >
                  {showToken ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              <p id="wa-token-hint" className={cn('hint', tokenLooksWrong && 'text-amber-600 dark:text-amber-400')}>
                {tokenLooksWrong ? t('setup.credentials.tokenFormat') : t('setup.credentials.tokenHint')}
              </p>
            </div>

            <div>
              <label htmlFor="wa-secret" className="label">{t('setup.credentials.secret')}</label>
              <input
                id="wa-secret"
                dir="ltr"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={hasStoredCredentials ? t('setup.credentials.keepSaved') : t('setup.credentials.secretPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={credError?.field === 'secret'}
                aria-describedby="wa-secret-hint"
                className={cn('field font-mono text-xs', credError?.field === 'secret' && 'border-red-400 focus:border-red-400 focus:ring-red-500/15')}
              />
              <p id="wa-secret-hint" className={cn('hint', secretLooksWrong && 'text-amber-600 dark:text-amber-400')}>
                {secretLooksWrong ? t('setup.credentials.secretFormat') : t('setup.credentials.secretHint')}
              </p>
            </div>

            {needsBusiness && (
              <div className="enter rounded-xl border border-line bg-raised p-4">
                <p className="text-sm font-semibold text-ink">{t('setup.credentials.business.title')}</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-3">{t('setup.credentials.business.body')}</p>
                <label htmlFor="wa-business" className="label mt-3">{t('setup.credentials.business.label')}</label>
                <input
                  id="wa-business"
                  dir="ltr"
                  inputMode="numeric"
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456789012345"
                  autoFocus
                  className="field font-mono text-xs"
                />
                <p className="hint">{t('setup.credentials.business.hint')}</p>
              </div>
            )}

            {credError && <div ref={credErrorRef}><Notice tone="error">{credError.text}</Notice></div>}

            <Actions>
              {onCancel ? (
                <button type="button" onClick={onCancel} className="btn btn-ghost">{t('panel.cancel')}</button>
              ) : <span />}
              <button type="submit" disabled={!canDiscover || discovering} className="btn btn-primary btn-lg">
                {discovering && <Loader2 className="animate-spin" aria-hidden="true" />}
                {discovering ? t('setup.credentials.finding') : t('setup.credentials.continue')}
                {!discovering && <ArrowRight className="icon-mirror" aria-hidden="true" />}
              </button>
            </Actions>
          </motion.form>
        )}

        {/* ── 2 · Number ──────────────────────────────────────────────────── */}
        {step === 'number' && (
          <motion.div key="number" {...slide} className="mt-6 flex flex-col gap-5">
            <header>
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{t('setup.number.title')}</h2>
              {numbers.length > 0 && (
                <p className="mt-1 text-[13px] leading-5 text-ink-3">{t('setup.number.found', { count: numbers.length })}</p>
              )}
            </header>

            {numbers.length === 0 ? (
              <Notice tone="warn" title={t('setup.number.none.title')}>{t('setup.number.none.body')}</Notice>
            ) : (
              <div role="radiogroup" aria-label={t('setup.number.title')} className="stagger flex flex-col gap-2">
                {numbers.map((n, i) => (
                  <NumberOption
                    key={n.phoneNumberId}
                    number={n}
                    recommended={i === 0 && n.status === 'CONNECTED' && n.canSend !== false && !n.isTestNumber}
                    selected={selected === n.phoneNumberId}
                    onSelect={() => setSelected(n.phoneNumberId)}
                  />
                ))}
              </div>
            )}

            {chosen?.isTestNumber && <Notice tone="info">{t('setup.number.testWarn')}</Notice>}
            {chosen && chosen.status !== 'CONNECTED' && <Notice tone="warn">{t('setup.number.notFinishedWarn')}</Notice>}

            <Actions>
              <button type="button" onClick={() => setStep('credentials')} className="btn btn-ghost">
                <ArrowLeft className="icon-mirror" aria-hidden="true" /> {t('setup.number.back')}
              </button>
              <button
                type="button"
                onClick={connect}
                disabled={!chosen || chosen.status !== 'CONNECTED'}
                className="btn btn-primary btn-lg"
              >
                {t('setup.number.connect')} <ArrowRight className="icon-mirror" aria-hidden="true" />
              </button>
            </Actions>
          </motion.div>
        )}

        {/* ── 3 · Finish ──────────────────────────────────────────────────── */}
        {step === 'finish' && (
          <motion.div key="finish" {...slide} className="mt-6 flex flex-col gap-5">
            <header>
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">
                {t('setup.finish.title', { number: chosen?.displayPhoneNumber ?? '' })}
              </h2>
            </header>

            <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-live="polite">
              {(results ?? ROW_ORDER.slice(0, 4).map((id) => ({ id, status: 'ok', code: '' }) as ConnectStep)).map((row, i) => {
                const status: RowStatus = connecting
                  ? i === 0 ? 'running' : 'pending'
                  : !results ? 'pending'
                  : i < revealed ? row.status
                  : i === revealed ? 'running'
                  : 'pending';
                const settled = !connecting && results && i < revealed;
                return (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                    <StatusIcon status={status} className="mt-px" />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[13px] font-medium', status === 'pending' ? 'text-ink-3' : 'text-ink')}>
                        {t(`setup.finish.rows.${row.id}`)}
                      </p>
                      {settled && row.status !== 'ok' && (
                        <p className="enter mt-0.5 text-xs leading-5 text-ink-3">
                          {t(`health.codes.${row.code}`, { detail: row.detail, defaultValue: row.detail ?? row.code })}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {connectError && (
              <>
                <Notice tone="error" title={t('setup.finish.failedTitle')}>{connectError}</Notice>
                <Actions>
                  <button type="button" onClick={() => setStep('credentials')} className="btn btn-ghost">
                    <ArrowLeft className="icon-mirror" aria-hidden="true" /> {t('setup.number.back')}
                  </button>
                  <button type="button" onClick={connect} className="btn btn-primary">{t('setup.finish.tryAgain')}</button>
                </Actions>
              </>
            )}

            {allRevealed && failedVerify && (
              <>
                <Notice tone="error" title={t('setup.finish.failedTitle')}>{failedVerify.detail}</Notice>
                <Actions>
                  <button type="button" onClick={() => setStep('credentials')} className="btn btn-ghost">
                    <ArrowLeft className="icon-mirror" aria-hidden="true" /> {t('setup.number.back')}
                  </button>
                  <button type="button" onClick={connect} className="btn btn-primary">{t('setup.finish.tryAgain')}</button>
                </Actions>
              </>
            )}

            {allRevealed && !failedVerify && openIssues.length === 0 && (
              <Success number={chosen?.displayPhoneNumber ?? ''} onOpen={onFinish} />
            )}

            {allRevealed && !failedVerify && openIssues.length > 0 && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{t('setup.finish.attentionTitle')}</p>
                  <p className="mt-0.5 text-[13px] text-ink-3">{t('setup.finish.attentionBody')}</p>
                </div>
                {openIssues.some((r) => r.code === 'NOT_REGISTERED_HERE') && (
                  <RegisterNumberCard onDone={(ok) => ok && markFixed('sending')} />
                )}
                {openIssues.some((r) => r.id === 'webhook') && (
                  <ManualWebhookCard
                    callbackUrl={manualWebhook?.callbackUrl ?? null}
                    verifyToken={manualWebhook?.verifyToken ?? null}
                    onFixed={() => markFixed('webhook')}
                  />
                )}
                {openIssues.some((r) => r.code === 'PAYMENT_METHOD') && <PaymentCard />}
                <div className="pt-1">
                  <button type="button" onClick={onFinish} className="btn btn-ghost text-ink-3">
                    {t('setup.finish.skip')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stepper({ current, labels, stepOf }: { current: number; labels: string[]; stepOf: string }) {
  return (
    <div>
      <p className="eyebrow sm:hidden">{stepOf}</p>
      <ol className="mt-2 grid grid-cols-3 gap-2 sm:mt-0" aria-label={stepOf}>
        {labels.map((label, i) => (
          <li key={label} aria-current={i === current ? 'step' : undefined} className="min-w-0">
            <div className="h-1 overflow-hidden rounded-full bg-overlay">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-slow ease-out"
                style={{ width: i < current ? '100%' : i === current ? '50%' : '0%' }}
              />
            </div>
            <p className={cn('mt-2 hidden truncate text-xs sm:block', i === current ? 'font-semibold text-ink' : i < current ? 'text-ink-2' : 'text-ink-4')}>
              {label}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between [&>.btn]:w-full sm:[&>.btn]:w-auto">{children}</div>;
}

function Guide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation('whatsapp');
  const steps = t('setup.credentials.guide.steps', { returnObjects: true }) as string[];
  return (
    <div className="rounded-xl border border-line bg-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-[13px] font-semibold text-ink"
      >
        {t('setup.credentials.guide.toggle')}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-3 transition-transform duration-base ease-out', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-base ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <ol className="space-y-3 border-t border-line px-4 py-4">
            {steps.map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface text-2xs font-semibold text-ink-2 ring-1 ring-line">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink-2">
                  <p>{text}</p>
                  {i === 0 && (
                    <a href={META_LINKS.systemUsers} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      {t('setup.credentials.guide.openSystemUsers')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  {i === 2 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {TOKEN_PERMISSIONS.map((p) => <PermissionChip key={p} value={p} />)}
                    </div>
                  )}
                  {i === 4 && (
                    <a href={META_LINKS.apps} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      {t('setup.credentials.guide.openApps')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** A permission name people must tick in Meta — click to copy, since Meta's list is searchable. */
function PermissionChip({ value }: { value: string }) {
  const { t } = useTranslation('whatsapp');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      dir="ltr"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* visible anyway */ }
      }}
      title={copied ? t('setup.credentials.guide.copied') : t('setup.credentials.guide.copy')}
      className={cn('chip press h-6 font-mono transition-colors', copied ? 'chip-brand' : 'chip-neutral hover:text-ink')}
    >
      {value}
    </button>
  );
}

function NumberOption({
  number: n,
  recommended,
  selected,
  onSelect,
}: {
  number: DiscoveredNumber;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('whatsapp');
  const ready = n.status === 'CONNECTED' && n.canSend !== false;
  const quality = (n.qualityRating ?? '').toUpperCase();
  const firstIssue = n.issues[0];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border bg-surface p-3.5 text-start outline-none transition-[border-color,box-shadow,background-color] duration-fast',
        'focus-visible:ring-[3px] focus-visible:ring-brand/25',
        selected ? 'border-brand ring-1 ring-brand/40' : 'border-line hover:border-line-strong hover:bg-raised',
      )}
    >
      <span className={cn('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors', selected ? 'border-brand' : 'border-line-strong')}>
        <span className={cn('h-2 w-2 rounded-full bg-brand transition-transform duration-fast ease-spring', selected ? 'scale-100' : 'scale-0')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span dir="ltr" className="font-mono text-[15px] font-semibold tabular-nums text-ink">{n.displayPhoneNumber}</span>
          {recommended && <span className="chip chip-brand">{t('setup.number.recommended')}</span>}
          {!recommended && ready && !n.isTestNumber && <span className="chip chip-neutral">{t('setup.number.ready')}</span>}
          {n.isTestNumber && <span className="chip chip-info">{t('setup.number.test')}</span>}
          {n.status !== 'CONNECTED' && <span className="chip chip-warn">{t('setup.number.notFinished')}</span>}
          {n.status === 'CONNECTED' && n.canSend === false && <span className="chip chip-danger">{t('setup.number.cannotSend')}</span>}
        </span>
        {n.verifiedName && <span className="mt-0.5 block truncate text-[13px] text-ink-2">{n.verifiedName}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-ink-4">
          {n.wabaId && <span dir="ltr">{t('setup.number.account', { id: n.wabaId })}</span>}
          {quality && quality !== 'UNKNOWN' && <span>{t('setup.number.quality', { q: quality })}</span>}
        </span>
        {firstIssue && n.status === 'CONNECTED' && (
          <span className="mt-1.5 block text-xs leading-5 text-ink-3">
            {t(`health.codes.${firstIssue.code}`, { defaultValue: firstIssue.message })}
          </span>
        )}
      </span>
      <Phone className={cn('mt-0.5 h-4 w-4 shrink-0 transition-colors', selected ? 'text-brand' : 'text-ink-4')} aria-hidden="true" />
    </button>
  );
}

function Success({ number, onOpen }: { number: string; onOpen: () => void }) {
  const { t } = useTranslation('whatsapp');
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return (
    <div className="pop-enter flex flex-col items-center rounded-xl border border-brand/25 bg-brand/[0.06] px-5 py-7 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-brand-fg shadow-brand">
        <PartyPopper className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-3 text-base font-semibold text-ink">{t('setup.finish.successTitle')}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-2">
        {t('setup.finish.successBody', { number })}
      </p>
      <button ref={button} type="button" onClick={onOpen} className="btn btn-primary btn-lg mt-5">
        {t('setup.finish.open')} <ArrowRight className="icon-mirror" aria-hidden="true" />
      </button>
    </div>
  );
}

