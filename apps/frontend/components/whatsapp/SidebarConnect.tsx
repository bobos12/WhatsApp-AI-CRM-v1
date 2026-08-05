'use client';

/**
 * SidebarConnect — a single status line in the sidebar footer.
 *
 * This used to render the QR code inline. It worked, but a 200px code plus its
 * hint text ate the bottom of the sidebar and pushed the navigation items out of
 * view — the connection prompt was hiding the app it was meant to unlock.
 *
 * So the code moved to where there is room for it: the dashboard's connection
 * strip, and the shared popup this line opens. What stays here is the one thing
 * that has to be visible from every page — whether we are connected, and to
 * which number.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Wifi, Check, QrCode } from 'lucide-react';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';
import ConnectWhatsAppModal from './ConnectWhatsAppModal';
import { cn } from '../../lib/utils';

export default function SidebarConnect() {
  const { t } = useTranslation('common');
  const { status, connectedPhone, tenantless } = useWhatsAppConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (tenantless) return null;

  const copyPhoneNumber = () => {
    if (connectedPhone) {
      navigator.clipboard.writeText(connectedPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Connected ──────────────────────────────────────────────────────────────
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

  // ── Checking ───────────────────────────────────────────────────────────────
  if (status === null) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[#25D366]" />
          <p className="text-xs font-medium text-gray-600 dark:text-[#8696A0]">
            {t('sidebarConnect.checking')}
          </p>
        </div>
      </div>
    );
  }

  // ── Not connected — same footprint as the connected line, opens the popup ──
  const connecting = status === 'connecting';

  return (
    <>
      <button
        type="button"
        onClick={() => setConnectOpen(true)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start transition-colors',
          connecting
            ? 'border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/15'
            : 'border-red-400/25 bg-red-400/10 hover:bg-red-400/15',
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', connecting ? 'bg-amber-400' : 'bg-red-400')} />
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', connecting ? 'bg-amber-500' : 'bg-red-500')} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-xs font-bold', connecting ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300')}>
            {connecting ? t('sidebarConnect.connectingShort') : t('sidebarConnect.disconnectedShort')}
          </p>
          <p className="truncate text-[10px] text-gray-500 dark:text-[#8696A0]">
            {t('sidebarConnect.tapToScan')}
          </p>
        </div>
        <QrCode className={cn('h-4 w-4 shrink-0', connecting ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400')} />
      </button>

      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
