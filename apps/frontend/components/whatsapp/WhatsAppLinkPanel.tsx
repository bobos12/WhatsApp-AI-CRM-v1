'use client';

/**
 * The connect flow for a WhatsApp Business number.
 *
 * This replaced a QR-scanning panel. On the official Cloud API there is nothing
 * to scan: a number belongs to a WhatsApp Business Account, and this CRM sends
 * through it using credentials from the tenant's Meta app. The job of this
 * screen is therefore to make copying four values out of Meta's dashboard feel
 * deliberate rather than clerical — one field per step, each explained where
 * the user needs it, and a live verification at the end so nobody discovers a
 * wrong token days later when a message silently fails to send.
 *
 * Deliberately not a single long form. The values live on different Meta screens,
 * and a wall of six inputs with no context is where self-serve onboarding dies.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';

type StepId = 'intro' | 'ids' | 'token' | 'webhook' | 'done';

interface ChannelInfo {
  configured: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  appId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  encryptionReady: boolean;
  webhookUrl: string;
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  tokenHint: string | null;
}

const META_APP_URL = 'https://developers.facebook.com/apps';

export default function WhatsAppLinkPanel({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { refresh, configured, connectedPhone, verifiedName } = useWhatsAppConnection();

  const [step, setStep] = useState<StepId>('intro');
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [appId, setAppId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showToken, setShowToken] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Load current channel state so a partially-configured tenant resumes rather
  // than retyping values the server already holds.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/channel');
        if (cancelled) return;
        setChannel(data);
        setPhoneNumberId(data.phoneNumberId ?? '');
        setWabaId(data.wabaId ?? '');
        setAppId(data.appId ?? '');
        if (data.configured) setStep('done');
      } catch {
        /* an unconfigured tenant simply starts at the beginning */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copy = useCallback(async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch { /* clipboard blocked — the value is visible and selectable anyway */ }
  }, []);

  // A stored token satisfies the requirement. Both secrets are write-only, so
  // the fields are empty on every reload — demanding a token here meant Save
  // stayed disabled forever once credentials existed, and there was no way to
  // correct the App Secret alone. Meta shows a system-user token exactly once,
  // so "just paste it again" is frequently not an option.
  const canSubmit =
    phoneNumberId.trim().length > 0 && (accessToken.trim().length > 0 || Boolean(channel?.tokenHint));

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.put('/api/channel/credentials', {
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim() || null,
        appId: appId.trim() || null,
        // Omitted when blank so the server keeps the stored one.
        accessToken: accessToken.trim() || undefined,
        appSecret: appSecret.trim() || null,
      });

      // The server saves and verifies in one call. A save that stored fine but
      // failed verification is the important case: the number is not usable, and
      // saying "connected" would be a lie the user discovers at their first send.
      if (result?.verified === false) {
        setError(result.error ?? 'WhatsApp did not accept these credentials.');
        return;
      }

      setAccessToken('');
      setAppSecret('');
      setChannel(result.channel ?? channel);
      await refresh();
      setStep('webhook');
    } catch (err: any) {
      setError(err?.message ?? 'Could not save these credentials.');
    } finally {
      setSaving(false);
    }
  }, [phoneNumberId, wabaId, appId, accessToken, appSecret, channel, refresh]);

  const compact = size === 'sm';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────
  if (configured && step === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-brand/15 text-brand dark:text-brand">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <div>
          <p className="text-base font-bold text-ink">Your number is connected</p>
          {connectedPhone && (
            <p className="mt-0.5 font-mono text-sm text-ink-3">{connectedPhone}</p>
          )}
          {verifiedName && (
            <p className="mt-0.5 text-xs text-ink-3">Verified as “{verifiedName}”</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setStep('ids')}
          className="mt-1 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-ink-3"
        >
          Update credentials
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StepDots current={step} />

      {/* ── Intro ───────────────────────────────────────────────────────────── */}
      {step === 'intro' && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-bold text-ink">
              Connect your WhatsApp Business number
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              This CRM sends through the official WhatsApp Business API, so there is no QR code to
              scan and no phone that has to stay online. You will copy four values from your Meta
              account — we will verify them before saving.
            </p>
          </div>

          <ul className="flex flex-col gap-2 rounded-2xl bg-gray-50 p-3 text-xs dark:bg-white/5">
            {[
              'Your number can never be banned for sending volume alone.',
              'Messages keep delivering when your phone is off.',
              'Meta publishes your quality rating, so problems are visible early.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-ink-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {channel && !channel.encryptionReady && (
            <Callout tone="warn">
              This server cannot store credentials securely yet — <code>CREDENTIAL_ENCRYPTION_KEY</code>{' '}
              is not set. Ask your administrator to configure it before connecting.
            </Callout>
          )}

          <a
            href={META_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-strong hover:underline dark:text-brand"
          >
            Open Meta for Developers <ExternalLink className="h-3 w-3" />
          </a>

          <Nav
            onNext={() => setStep('ids')}
            nextLabel="Start"
            nextDisabled={Boolean(channel && !channel.encryptionReady)}
          />
        </div>
      )}

      {/* ── IDs ─────────────────────────────────────────────────────────────── */}
      {step === 'ids' && (
        <div className="flex flex-col gap-3">
          <FieldHelp
            title="Where to find these"
            body="In your Meta app, open WhatsApp → API Setup. The Phone Number ID and WhatsApp Business Account ID are shown directly above the message-sending panel."
          />

          <Field
            label="Phone Number ID"
            required
            value={phoneNumberId}
            onChange={setPhoneNumberId}
            placeholder="123456789012345"
            hint="Digits only — not the phone number itself."
            compact={compact}
          />
          <Field
            label="WhatsApp Business Account ID"
            value={wabaId}
            onChange={setWabaId}
            placeholder="987654321098765"
            hint="Needed to create and submit message templates."
            compact={compact}
          />
          <Field
            label="App ID"
            value={appId}
            onChange={setAppId}
            placeholder="1234567890"
            hint="Only needed for templates with an image or video header."
            compact={compact}
          />

          <Nav
            onBack={() => setStep('intro')}
            onNext={() => setStep('token')}
            nextDisabled={!phoneNumberId.trim()}
          />
        </div>
      )}

      {/* ── Token ───────────────────────────────────────────────────────────── */}
      {step === 'token' && (
        <div className="flex flex-col gap-3">
          <FieldHelp
            title="Use a permanent token"
            body="The temporary token on the API Setup page expires in 24 hours. Create a System User in Business Settings, give it access to your WhatsApp account, and generate a permanent token with the whatsapp_business_messaging and whatsapp_business_management permissions."
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-ink-2">
              Permanent access token <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={channel?.tokenHint ? `Saved: ${channel.tokenHint}` : 'EAAG…'}
                autoComplete="off"
                spellCheck={false}
                className="field field-sm w-full pr-10 font-mono transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Hide token' : 'Show token'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-ink-4">
              Stored encrypted. It is never shown again after saving.
            </p>
          </div>

          <Field
            label="App Secret"
            value={appSecret}
            onChange={setAppSecret}
            placeholder={channel?.appSecretSet ? 'Saved — leave blank to keep' : '32-character secret'}
            hint="From App Settings → Basic. Used to verify that incoming messages genuinely came from Meta."
            type="password"
            compact={compact}
          />

          {error && <Callout tone="error">{error}</Callout>}

          <Nav
            onBack={() => setStep('ids')}
            onNext={submit}
            nextLabel={saving ? 'Verifying…' : 'Save and verify'}
            nextDisabled={!canSubmit || saving}
            busy={saving}
          />
        </div>
      )}

      {/* ── Webhook ─────────────────────────────────────────────────────────── */}
      {step === 'webhook' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-2xl bg-brand/10 p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand dark:text-brand" />
            <p className="text-xs text-ink-2">
              Credentials verified{connectedPhone ? ` for ${connectedPhone}` : ''}. One last step so
              you can <strong>receive</strong> messages, not just send them.
            </p>
          </div>

          <FieldHelp
            title="Point Meta's webhook at this CRM"
            body="In your Meta app, open WhatsApp → Configuration → Webhooks, paste the callback URL and verify token below, then subscribe to the messages field."
          />

          <CopyRow
            label="Callback URL"
            value={channel?.webhookUrl || `${window.location.origin.replace(/:\d+$/, ':4000')}/api/whatsapp/meta-webhook`}
            copied={copied === 'url'}
            onCopy={(v) => copy(v, 'url')}
          />

          {channel?.verifyTokenSet ? (
            <p className="text-[11px] text-ink-3">
              Use the verify token your administrator configured on this server.
            </p>
          ) : (
            <Callout tone="warn">
              No verify token is configured on this server yet. Ask your administrator to set{' '}
              <code>META_WEBHOOK_VERIFY_TOKEN</code>, or Meta cannot complete the handshake.
            </Callout>
          )}

          <Callout tone="info">
            Subscribe to <strong>messages</strong>. Without it, replies from your customers will
            never reach this inbox.
          </Callout>

          <Nav onNext={() => { void refresh(); setStep('done'); }} nextLabel="Finish" />
        </div>
      )}
    </div>
  );
}

// ── Presentational helpers ───────────────────────────────────────────────────

const STEPS: StepId[] = ['intro', 'ids', 'token', 'webhook'];

function StepDots({ current }: { current: StepId }) {
  if (current === 'done') return null;
  const index = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={index + 1} aria-valuemax={STEPS.length}>
      {STEPS.map((s, i) => (
        <span
          key={s}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i <= index ? 'bg-brand' : 'bg-overlay'
          }`}
        />
      ))}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, hint, required, type = 'text', compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-ink-2">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`w-full rounded-xl border border-gray-200 bg-white px-3 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-brand dark:border-white/10 dark:bg-white/5 dark:text-white ${
          compact ? 'py-1.5' : 'py-2'
        }`}
      />
      {hint && <p className="text-[11px] text-ink-4">{hint}</p>}
    </div>
  );
}

function FieldHelp({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-gray-50 p-3 dark:bg-white/5">
      <p className="text-xs font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}

function CopyRow({
  label, value, copied, onCopy,
}: { label: string; value: string; copied: boolean; onCopy: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
        <code className="flex-1 truncate font-mono text-[11px] text-ink-2">{value}</code>
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="shrink-0 text-gray-400 transition-colors hover:text-brand-strong dark:hover:text-brand"
          aria-label={`Copy ${label}`}
        >
          {copied ? <CheckCircle2 className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Callout({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const styles = {
    info: 'bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200',
    warn: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200',
    error: 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200',
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-xl p-3 text-[11px] leading-relaxed ${styles}`}>
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Nav({
  onBack, onNext, nextLabel = 'Continue', nextDisabled, busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-ink-3 dark:hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="btn btn-primary btn-sm inline-flex disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {nextLabel}
        {!busy && <ArrowRight className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
