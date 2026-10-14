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
import { Check, QrCode } from 'lucide-react';
import { useWhatsAppConnection } from './WhatsAppConnectProvider';
import ConnectWhatsAppModal from './ConnectWhatsAppModal';
import { cn } from '../../lib/utils';

export default function SidebarConnect({ compact = false }: { compact?: boolean | 'below-lg' }) {
  const { t } = useTranslation('common');
  const { status, connectedPhone, tenantless } = useWhatsAppConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (tenantless) return null;

  const railAlways = compact === true;
  const textCls = cn('min-w-0 flex-1 text-start leading-tight', railAlways ? 'hidden' : compact === 'below-lg' ? 'hidden lg:block' : '');
  const rowCls = cn(
    'flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 transition-colors',
    (railAlways || compact === 'below-lg') && 'justify-center',
    compact === 'below-lg' && 'lg:justify-start',
  );

  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const checking = status === null;

  const label = connected
    ? t('sidebarConnect.connectedShort')
    : checking
      ? t('sidebarConnect.checking')
      : connecting
        ? t('sidebarConnect.connectingShort')
        : t('sidebarConnect.disconnectedShort');

  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {connected && <span className="absolute inset-0 animate-ping rounded-full bg-brand-400 opacity-40 [animation-duration:2.4s]" />}
      <span className={cn(
        'relative inline-flex h-2 w-2 rounded-full',
        connected ? 'bg-brand-400' : checking ? 'bg-nav-muted' : connecting ? 'bg-amber-400' : 'bg-red-500',
      )} />
    </span>
  );

  if (connected || checking) {
    const copyPhoneNumber = () => {
      if (!connectedPhone) return;
      navigator.clipboard.writeText(connectedPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    return (
      <button
        type="button"
        onClick={copyPhoneNumber}
        disabled={!connectedPhone}
        title={connectedPhone ? `${label} · ${connectedPhone}` : label}
        className={cn(rowCls, 'hover:bg-nav-hover disabled:hover:bg-transparent')}
      >
        {dot}
        <span className={textCls}>
          <span className="block truncate text-xs font-medium text-nav-ink">{label}</span>
          {connectedPhone && (
            <span dir="ltr" className="block truncate font-mono text-[10px] text-nav-muted">
              {copied ? <Check className="inline h-3 w-3 text-brand-400" aria-hidden="true" /> : connectedPhone}
            </span>
          )}
        </span>
      </button>
    );
  }

  // Not connected: the same footprint, but it is a call to action.
  return (
    <>
      <button
        type="button"
        onClick={() => setConnectOpen(true)}
        title={`${label} — ${t('sidebarConnect.tapToScan')}`}
        className={cn(rowCls, connecting ? 'bg-amber-400/10 hover:bg-amber-400/15' : 'bg-red-500/10 hover:bg-red-500/15')}
      >
        {dot}
        <span className={textCls}>
          <span className={cn('block truncate text-xs font-semibold', connecting ? 'text-amber-300' : 'text-red-300')}>{label}</span>
          <span className="block truncate text-[10px] text-nav-muted">{t('sidebarConnect.tapToScan')}</span>
        </span>
        <QrCode className={cn('h-4 w-4 shrink-0', connecting ? 'text-amber-300' : 'text-red-300', textCls.includes('hidden') && 'hidden', compact === 'below-lg' && 'lg:block')} aria-hidden="true" />
      </button>

      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
