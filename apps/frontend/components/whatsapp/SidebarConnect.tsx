'use client';

/**
 * SidebarConnect — live WhatsApp connection in the sidebar footer.
 *
 * When connected it's a calm status line. When it isn't, the QR code renders
 * inline right here — the user scans it without opening anything or leaving the
 * page. The handshake and live QR refresh are handled by useWhatsAppConnect.
 * Users can expand to fullscreen for easier scanning.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, WifiOff, Maximize2, X, Copy, Check } from 'lucide-react';
import { useWhatsAppConnect } from '../../hooks/useWhatsAppConnect';
import QRCodeDisplay from '../shared/QRCodeDisplay';

export default function SidebarConnect() {
  const { t } = useTranslation('common');
  const { status, connectedPhone, qrCode, error, tenantless, retry } = useWhatsAppConnect(true);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (tenantless) return null;

  const copyPhoneNumber = () => {
    if (connectedPhone) {
      navigator.clipboard.writeText(connectedPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Connected state
  if (status === 'connected') {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 bg-gradient-to-r from-[#16A34A]/10 to-[#25D366]/10 border border-[#16A34A]/20 dark:from-[#25D366]/5 dark:to-[#25D366]/5 dark:border-[#25D366]/20">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-[#16A34A] dark:bg-[#25D366]" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#16A34A] dark:bg-[#25D366]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-gray-900 dark:text-white">
                {t('sidebarConnect.connectedShort')}
              </p>
              {connectedPhone && (
                <button
                  type="button"
                  onClick={copyPhoneNumber}
                  className="group truncate font-mono text-[10px] text-gray-500 dark:text-[#8696A0] hover:text-gray-700 dark:hover:text-white transition-colors"
                  title="Click to copy"
                >
                  {connectedPhone}
                </button>
              )}
            </div>
          </div>
          {copied ? (
            <Check className="h-4 w-4 shrink-0 text-[#16A34A] dark:text-[#25D366]" />
          ) : (
            <Wifi className="h-4 w-4 shrink-0 text-[#16A34A] dark:text-[#25D366]" />
          )}
        </div>
      </div>
    );
  }

  // Checking state
  if (status === null) {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[#25D366]" />
            <p className="text-xs font-medium text-gray-600 dark:text-[#8696A0]">
              {t('sidebarConnect.checking')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Disconnected state with inline QR
  return (
    <>
      <div className="w-full">
        {/* Compact card */}
        <div className="mx-auto overflow-hidden rounded-2xl border border-[#128C7E]/30 bg-gradient-to-b from-[#128C7E] via-[#1aa06e] to-[#25D366] shadow-lg hover:shadow-xl transition-shadow">
          {/* Header */}
          <div className="relative px-3 pt-3 pb-2">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold leading-tight text-white">{t('sidebarConnect.title')}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-white/85">{t('sidebarConnect.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="shrink-0 p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white"
                aria-label="Expand QR code"
                title="Expand for easier scanning"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* QR content */}
          <div className="px-2.5 pb-2.5">
            <div className="relative overflow-hidden rounded-xl bg-white p-2 shadow-sm">
              {/* Scanner corner brackets */}
              <span aria-hidden className="absolute left-1 top-1 h-3 w-3 rounded-tl-md border-l-2 border-t-2 border-[#25D366]" />
              <span aria-hidden className="absolute right-1 top-1 h-3 w-3 rounded-tr-md border-r-2 border-t-2 border-[#25D366]" />
              <span aria-hidden className="absolute bottom-1 left-1 h-3 w-3 rounded-bl-md border-b-2 border-l-2 border-[#25D366]" />
              <span aria-hidden className="absolute bottom-1 right-1 h-3 w-3 rounded-br-md border-b-2 border-r-2 border-[#25D366]" />

              {error ? (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-center">
                  <WifiOff className="h-6 w-6 text-red-500" />
                  <p className="px-2 text-[10px] font-medium text-gray-600">{t('sidebarConnect.error')}</p>
                  <button
                    type="button"
                    onClick={retry}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#128C7E] px-2.5 py-1 text-[10px] font-bold text-white transition-colors hover:bg-[#0f7a6e] active:scale-95"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t('sidebarConnect.retry')}
                  </button>
                </div>
              ) : qrCode ? (
                <div className="[&_img]:aspect-square [&_img]:h-auto [&_img]:w-full [&_img]:max-w-none">
                  <QRCodeDisplay qrCode={qrCode} />
                </div>
              ) : (
                <div className="grid aspect-square w-full place-items-center rounded-lg bg-gradient-to-br from-gray-50 to-gray-100">
                  <RefreshCw className="h-6 w-6 animate-spin text-[#25D366]" />
                </div>
              )}
            </div>

            <p className="mt-2 px-0.5 text-center text-[9px] leading-snug text-white/90">
              {t('sidebarConnect.inlineHint')}
            </p>
          </div>
        </div>
      </div>

      {/* Expanded modal for scanning */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm bg-white dark:bg-[#111B21] rounded-3xl shadow-2xl overflow-hidden">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors text-gray-700 dark:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Content */}
            <div className="bg-gradient-to-b from-[#128C7E] via-[#1aa06e] to-[#25D366] p-8">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-white">{t('sidebarConnect.title')}</h2>
                <p className="text-sm text-white/90 mt-1">{t('sidebarConnect.subtitle')}</p>
              </div>

              {/* QR display */}
              <div className="bg-white rounded-2xl p-6 shadow-lg">
                {error ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <WifiOff className="h-10 w-10 text-red-500" />
                    <div>
                      <p className="font-medium text-gray-900">{t('sidebarConnect.error')}</p>
                      <p className="text-sm text-gray-500 mt-1">Please try again</p>
                    </div>
                    <button
                      type="button"
                      onClick={retry}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#128C7E] px-4 py-2 text-sm font-bold text-white transition-all hover:bg-[#0f7a6e] active:scale-95"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t('sidebarConnect.retry')}
                    </button>
                  </div>
                ) : qrCode ? (
                  <div className="relative">
                    <div className="[&_img]:aspect-square [&_img]:h-auto [&_img]:w-full [&_img]:max-w-none">
                      <QRCodeDisplay qrCode={qrCode} />
                    </div>
                  </div>
                ) : (
                  <div className="grid aspect-square place-items-center rounded-xl bg-gradient-to-br from-gray-50 to-gray-100">
                    <RefreshCw className="h-8 w-8 animate-spin text-[#25D366]" />
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="mt-6 text-center">
                <p className="text-sm font-medium text-white">
                  Open WhatsApp on your phone
                </p>
                <p className="text-xs text-white/80 mt-1">
                  Go to Settings → Linked Devices → Link a Device
                </p>
                <p className="text-xs text-white/80 mt-1">
                  Point your camera at the QR code
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
