'use client';

/**
 * useWhatsAppConnect — drives the connect handshake and keeps a live QR ready.
 *
 * Shared by the inline sidebar connector and the banner modal so the flow behaves
 * identically everywhere: while `enabled` and not yet connected it kicks off the
 * handshake, pulls the QR, live-refreshes it over the `wa:qr` / `wa:status`
 * sockets, and falls back to a short poll so a dropped socket frame never leaves a
 * stale code on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useSocket } from './useSocket';

export type WaStatus = 'connected' | 'disconnected' | 'connecting';

export interface WhatsAppConnectState {
  status: WaStatus | null;
  connectedPhone: string | null;
  qrCode: string | null;
  error: string | null;
  /** True when the current identity has no WhatsApp of its own (a platform operator). */
  tenantless: boolean;
  /** Re-run the handshake (used by the error "try again" action). */
  retry: () => void;
}

export function useWhatsAppConnect(enabled: boolean): WhatsAppConnectState {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tenantless, setTenantless] = useState(false);

  // Guards a single connect POST per disconnected episode — the socket, the poll
  // and re-renders all funnel through here without hammering the endpoint.
  const initiatedRef = useRef(false);

  const fetchQR = useCallback(async () => {
    try {
      const data = await api.get('/api/whatsapp/qr');
      setQrCode(data.qr ?? null);
    } catch {
      /* the QR simply isn't ready yet */
    }
  }, []);

  const beginConnect = useCallback(async () => {
    setError(null);
    try {
      await api.post('/api/whatsapp/connect', {});
      await fetchQR();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'connect_failed');
    }
  }, [fetchQR]);

  const retry = useCallback(() => {
    initiatedRef.current = true;
    beginConnect();
  }, [beginConnect]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get('/api/whatsapp/status');
      // A platform operator with no business of their own: nothing to connect.
      if (data.tenantless) {
        setTenantless(true);
        setStatus('disconnected');
        setQrCode(null);
        return;
      }
      setTenantless(false);
      const next: WaStatus = data.status;
      setStatus(next);
      setConnectedPhone(data.connectedPhone ?? null);

      if (next === 'connected') {
        initiatedRef.current = false;
        setQrCode(null);
        return;
      }
      // Not connected: make sure a handshake is running and a QR is on its way.
      if (!initiatedRef.current) {
        initiatedRef.current = true;
        beginConnect();
      } else {
        fetchQR();
      }
    } catch {
      /* transient — the poll will retry */
    }
  }, [beginConnect, fetchQR]);

  // Start/stop with `enabled`.
  useEffect(() => {
    if (!enabled) {
      initiatedRef.current = false;
      setQrCode(null);
      setError(null);
      return;
    }
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Live socket updates — near-instant connect/QR transitions.
  useSocket('wa:status', () => { if (enabled) fetchStatus(); });
  useSocket('wa:qr', () => { if (enabled) fetchQR(); });

  // Fallback poll while waiting.
  useEffect(() => {
    if (!enabled || status === 'connected') return;
    const id = setInterval(() => { fetchStatus(); }, 4000);
    return () => clearInterval(id);
  }, [enabled, status, fetchStatus]);

  return { status, connectedPhone, qrCode, error, tenantless, retry };
}
