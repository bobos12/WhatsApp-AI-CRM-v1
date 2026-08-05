'use client';

/**
 * ConnectWhatsAppModal — THE connect popup. There is deliberately only one.
 *
 * Both entry points (the app-wide connect banner and the sidebar's expand
 * button) render this. They used to render two different hand-rolled dialogs
 * that looked similar, behaved differently, and drifted: one was translated and
 * one had English hardcoded, neither could ask for a fresh QR, and neither knew
 * what to show once pairing went idle.
 *
 * The connection comes from WhatsAppConnectProvider rather than a local hook.
 * Two live useWhatsAppConnect instances on one page means two handshakes racing
 * for the same socket, which is exactly how pairing ends up stuck.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, X, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/modal';
import WhatsAppLinkPanel from './WhatsAppLinkPanel';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';

interface ConnectWhatsAppModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ConnectWhatsAppModal({ open, onClose }: ConnectWhatsAppModalProps) {
  const { t } = useTranslation('common');
  const { status, connectedPhone } = useWhatsAppConnection();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss shortly after a successful connect so the success state is seen.
  useEffect(() => {
    if (open && status === 'connected') {
      closeTimer.current = setTimeout(onClose, 1800);
      return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
    }
  }, [open, status, onClose]);

  const connected = status === 'connected';

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label={t('sidebarConnect.title')}
      className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-[#111B21]"
    >
      {/* ── Header — WhatsApp gradient ────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#128C7E] via-[#1aa06e] to-[#25D366] px-5 py-4">
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20 text-white ring-1 ring-white/25 backdrop-blur-sm">
            <Smartphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-white">{t('sidebarConnect.title')}</h2>
            <p className="truncate text-xs text-white/85">{t('sidebarConnect.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('sidebarConnect.close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="p-5">
        {connected ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center animate-fade-in">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[#25D366]/15 text-[#16A34A] dark:text-[#25D366]">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{t('sidebarConnect.connectedTitle')}</p>
            {connectedPhone && (
              <p className="font-mono text-sm text-gray-500 dark:text-[#8696A0]">{connectedPhone}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <WhatsAppLinkPanel size="md" />

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 dark:text-[#8696A0]">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{t('sidebarConnect.secure')}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
