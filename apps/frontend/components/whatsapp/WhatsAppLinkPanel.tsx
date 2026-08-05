'use client';

/**
 * WhatsAppLinkPanel — the one surface for linking a number, both ways round.
 *
 * The QR code silently assumes a second screen. If you are running this CRM on
 * your phone — which most small operators are — the code is displayed on the
 * only camera you own, and the scan route has no path to completion at all. It
 * isn't awkward, it's impossible, and there was no other way through.
 *
 * So this panel offers WhatsApp's two official routes:
 *
 *   qr   → scan, for anyone with a second device
 *   code → "Link with phone number", an 8-character code typed into WhatsApp
 *
 * On a touch device there is no choice to offer — the QR cannot work there — so
 * the tabs are not shown at all and the number field IS the screen. Presenting
 * two options when one of them is impossible just asks the user to figure that
 * out for themselves. The scan route stays reachable through one line of small
 * print, for the rarer case of linking a number that lives on a second phone.
 *
 * Every state of both routes lives here — waiting, expired pairing, error, and
 * the refresh that recovers all of them — so no caller has to reimplement what
 * "no code yet" looks like.
 *
 * Connection state comes from WhatsAppConnectProvider, so no two surfaces run
 * competing handshakes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, WifiOff, QrCode, Smartphone, Copy, Check, ArrowRight } from 'lucide-react';
import QRCodeDisplay from '../shared/QRCodeDisplay';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';
import { cn } from '../../lib/utils';

type LinkMethod = 'qr' | 'code';

interface WhatsAppLinkPanelProps {
  /** Width of the code area. `lg` is for full-width pages, `md` for dialogs. */
  size?: 'md' | 'lg';
  className?: string;
}

const CODE_WIDTH = { md: 'w-52', lg: 'w-64' } as const;

/** `K73P9M2Q` → `K73P 9M2Q`. Eight characters is two glances, not one. */
function formatPairingCode(code: string): string {
  const clean = code.replace(/\s+/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
}

export default function WhatsAppLinkPanel({ size = 'md', className }: WhatsAppLinkPanelProps) {
  const { t } = useTranslation('common');
  const {
    qrCode, pairingIdle, error, refreshing, refreshQr,
    pairing, requestingCode, codeError, requestPairingCode, clearPairing,
  } = useWhatsAppConnection();

  const [method, setMethod] = useState<LinkMethod>('qr');
  /** Touch device — the QR is on the only camera they have, so it cannot work. */
  const [touchOnly, setTouchOnly] = useState(false);
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const touched = useRef(false);
  // A code can also die before its countdown ends — its keypair belongs to the
  // socket, and the socket goes away when WhatsApp's pairing refs run out. The
  // form reappearing with no explanation reads as the button having done nothing.
  const hadCode = useRef(false);

  // A phone or tablet cannot scan its own screen, so there is one route, not two.
  // Deferred to an effect so SSR and hydration agree on the initial markup.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      setTouchOnly(true);
      if (!touched.current) setMethod('code');
    }
  }, []);

  // A live code means someone is mid-entry on their phone. Never pull them back
  // to the QR tab underneath them.
  useEffect(() => {
    if (pairing) {
      setMethod('code');
      hadCode.current = true;
    }
  }, [pairing]);

  // Countdown. The code stops working when WhatsApp says so, and a user staring
  // at a dead code with no explanation assumes the feature is broken.
  useEffect(() => {
    if (!pairing) { setSecondsLeft(null); return; }
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      return left;
    };
    if (tick() === 0) return;
    const id = setInterval(() => { if (tick() === 0) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const expired = pairing != null && secondsLeft === 0;

  const countdown = useMemo(() => {
    if (secondsLeft == null) return null;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [secondsLeft]);

  const chooseMethod = (next: LinkMethod) => {
    touched.current = true;
    setMethod(next);
  };

  const copyCode = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is permission-gated and can simply say no. The code is on
      // screen either way, so a failed copy is not worth interrupting anyone.
    }
  };

  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || requestingCode) return;
    void requestPairingCode(digits);
  };

  const qrState: 'error' | 'idle' | 'code' | 'waiting' = error
    ? 'error'
    : pairingIdle
      ? 'idle'
      : qrCode
        ? 'code'
        : 'waiting';

  return (
    <div className={cn('flex w-full flex-col items-center gap-4', className)}>
      {/* ── Method switch — only where there is genuinely a choice ─────────── */}
      {!touchOnly && (
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-white/10 dark:bg-white/5">
          {([
            { key: 'qr' as const, icon: QrCode, label: t('sidebarConnect.methodQr') },
            { key: 'code' as const, icon: Smartphone, label: t('sidebarConnect.methodCode') },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseMethod(key)}
              aria-pressed={method === key}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                method === key
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-[#2A3942] dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-[#8696A0] dark:hover:text-white',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Scan ──────────────────────────────────────────────────────────── */}
      {method === 'qr' && (
        <div className="flex flex-col items-center gap-3.5">
          <div className={cn('relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-white/10', CODE_WIDTH[size])}>
            {/* Scanner corner brackets — reads as "point your camera here". */}
            <span aria-hidden className="absolute left-1.5 top-1.5 h-4 w-4 rounded-tl-lg border-l-2 border-t-2 border-[#25D366]" />
            <span aria-hidden className="absolute right-1.5 top-1.5 h-4 w-4 rounded-tr-lg border-r-2 border-t-2 border-[#25D366]" />
            <span aria-hidden className="absolute bottom-1.5 left-1.5 h-4 w-4 rounded-bl-lg border-b-2 border-l-2 border-[#25D366]" />
            <span aria-hidden className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-br-lg border-b-2 border-r-2 border-[#25D366]" />

            {qrState === 'code' ? (
              <div className="[&_img]:aspect-square [&_img]:h-auto [&_img]:w-full [&_img]:max-w-none">
                <QRCodeDisplay qrCode={qrCode!} />
              </div>
            ) : (
              <div className="grid aspect-square w-full place-items-center gap-2 rounded-lg bg-gray-50 px-3 text-center">
                {qrState === 'error' && (
                  <div className="flex flex-col items-center gap-2">
                    <WifiOff className="h-8 w-8 text-red-500" />
                    <p className="text-xs font-medium text-gray-600">{t('sidebarConnect.error')}</p>
                  </div>
                )}
                {qrState === 'idle' && (
                  <div className="flex flex-col items-center gap-2">
                    <QrCode className="h-8 w-8 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-700">{t('sidebarConnect.expired')}</p>
                    <p className="max-w-[15rem] text-[11px] leading-relaxed text-gray-500">
                      {t('sidebarConnect.expiredHint')}
                    </p>
                  </div>
                )}
                {qrState === 'waiting' && (
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="h-8 w-8 animate-spin text-[#25D366]" />
                    <p className="text-xs font-medium text-gray-500">{t('sidebarConnect.waiting')}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Refresh — present in every state, not only on failure: a WhatsApp QR
              is valid for about a minute and the usual failure is looking away. */}
          <button
            type="button"
            onClick={refreshQr}
            disabled={refreshing}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-all active:scale-95 disabled:opacity-60',
              qrState === 'idle' || qrState === 'error'
                ? 'bg-[#128C7E] text-white hover:bg-[#0f7a6e]'
                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10',
            )}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            {refreshing ? t('sidebarConnect.refreshing') : t('sidebarConnect.refresh')}
          </button>

          {/* Steps live with the method they describe. They used to sit in the
              callers, which meant "scan this code to link" stayed on screen after
              switching to the tab where nothing gets scanned. */}
          <ol className="w-full max-w-sm space-y-2 rounded-xl bg-gray-50 p-3.5 dark:bg-white/5">
            {[
              t('sidebarConnect.steps.open'),
              t('sidebarConnect.steps.linked'),
              t('sidebarConnect.steps.scan'),
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#25D366]/12 text-[10px] font-bold text-[#16A34A] dark:text-[#25D366]">
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed text-gray-600 dark:text-[#c8d2d7]">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Link with phone number ────────────────────────────────────────── */}
      {method === 'code' && (
        <div className="w-full max-w-sm">
          {pairing && !expired ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-center text-xs font-semibold text-gray-500 dark:text-[#8696A0]">
                {t('sidebarConnect.codeHeading')}
              </p>

              <button
                type="button"
                onClick={copyCode}
                title={t('sidebarConnect.copyCode')}
                className="group flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#25D366]/40 bg-[#25D366]/[0.06] px-4 py-4 transition-colors hover:bg-[#25D366]/[0.12]"
              >
                <span dir="ltr" className="font-mono text-2xl font-extrabold tracking-[0.25em] text-gray-900 sm:text-3xl dark:text-white">
                  {formatPairingCode(pairing.code)}
                </span>
                {copied
                  ? <Check className="h-5 w-5 shrink-0 text-[#16A34A] dark:text-[#25D366]" aria-hidden="true" />
                  : <Copy className="h-5 w-5 shrink-0 text-gray-400 transition-colors group-hover:text-gray-600 dark:group-hover:text-white" aria-hidden="true" />}
              </button>

              {countdown && (
                <p className={cn('text-xs font-semibold tabular-nums', (secondsLeft ?? 0) < 30 ? 'text-red-500' : 'text-gray-400 dark:text-[#8696A0]')}>
                  {t('sidebarConnect.codeExpiresIn', { time: countdown })}
                </p>
              )}

              <ol className="w-full space-y-2 rounded-xl bg-gray-50 p-3.5 dark:bg-white/5">
                {[
                  t('sidebarConnect.codeSteps.open'),
                  t('sidebarConnect.codeSteps.linked'),
                  t('sidebarConnect.codeSteps.linkWithPhone'),
                  t('sidebarConnect.codeSteps.enter'),
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#25D366]/12 text-[10px] font-bold text-[#16A34A] dark:text-[#25D366]">
                      {i + 1}
                    </span>
                    <span className="text-xs leading-relaxed text-gray-600 dark:text-[#c8d2d7]">{step}</span>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                onClick={() => { clearPairing(); setPhone(''); hadCode.current = false; }}
                className="text-xs font-semibold text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-800 dark:text-[#8696A0] dark:hover:text-white"
              >
                {t('sidebarConnect.useAnotherNumber')}
              </button>
            </div>
          ) : (
            <form onSubmit={submitPhone} className="flex flex-col gap-3">
              <div>
                <label htmlFor="wa-pairing-phone" className="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-white">
                  {t('sidebarConnect.phoneLabel')}
                </label>
                <input
                  id="wa-pairing-phone"
                  dir="ltr"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+971 50 123 4567"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/20 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-[#8696A0]"
                />
                <p className={cn(
                  'mt-1.5 text-[11px] leading-relaxed',
                  expired || hadCode.current
                    ? 'font-medium text-amber-600 dark:text-amber-400'
                    : 'text-gray-500 dark:text-[#8696A0]',
                )}>
                  {expired || hadCode.current
                    ? t('sidebarConnect.codeExpired')
                    : t('sidebarConnect.phoneHint')}
                </p>
              </div>

              {codeError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400">
                  {codeError}
                </p>
              )}

              <button
                type="submit"
                disabled={requestingCode || phone.replace(/\D/g, '').length < 8}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#16A34A] px-4 py-2.5 text-sm font-bold text-white shadow-[0_2px_10px_rgba(22,163,74,0.25)] transition-all hover:bg-[#15803D] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#25D366] dark:text-slate-950 dark:hover:bg-[#22c55e]"
              >
                {requestingCode
                  ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
                {requestingCode ? t('sidebarConnect.gettingCode') : t('sidebarConnect.getCode')}
              </button>

              {/* Small print, not a tab. Linking a number that lives on a second
                  phone is real but rare — it shouldn't cost every mobile user a
                  choice between a route that works and one that can't. */}
              {touchOnly && (
                <button
                  type="button"
                  onClick={() => chooseMethod('qr')}
                  className="mx-auto text-[11px] font-semibold text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-600 dark:text-[#8696A0] dark:hover:text-white"
                >
                  {t('sidebarConnect.scanInstead')}
                </button>
              )}
            </form>
          )}
        </div>
      )}

      {/* The way back, once a touch user has opted into the scan route. */}
      {touchOnly && method === 'qr' && (
        <button
          type="button"
          onClick={() => chooseMethod('code')}
          className="text-[11px] font-semibold text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-600 dark:text-[#8696A0] dark:hover:text-white"
        >
          {t('sidebarConnect.useNumberInstead')}
        </button>
      )}
    </div>
  );
}
