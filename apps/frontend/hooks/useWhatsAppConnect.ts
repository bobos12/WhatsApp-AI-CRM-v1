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

/** A live "link with phone number" code — the route that needs no second screen. */
export interface PairingCodeInfo {
  code: string;
  /** Digits only, as accepted by the server. */
  phone: string;
  expiresAt: string;
}

export interface WhatsAppConnectState {
  status: WaStatus | null;
  connectedPhone: string | null;
  qrCode: string | null;
  error: string | null;
  /** True when the current identity has no WhatsApp of its own (a platform operator). */
  tenantless: boolean;
  /**
   * Pairing gave up: several QR codes expired unscanned and the server stopped
   * issuing new ones. Distinct from "waiting for a code" — this one needs the
   * user to press something, and without surfacing it the screen just shows an
   * empty box forever.
   */
  pairingIdle: boolean;
  /** True while a refresh is in flight, so the button can show progress. */
  refreshing: boolean;
  /**
   * Ask for a fresh QR code. This is also the "try again" action after an error —
   * there used to be a separate `retry`, which did strictly less (it left the
   * expired code and the idle flag in place) and only existed because each
   * surface had wired up its own button.
   */
  refreshQr: () => Promise<void>;

  /** The live pairing code, once one has been issued. */
  pairing: PairingCodeInfo | null;
  /** True while a pairing code is being requested. */
  requestingCode: boolean;
  /** Why the last pairing-code request failed, in words fit to show a user. */
  codeError: string | null;
  /** Ask WhatsApp for an 8-character code for this number (any format). */
  requestPairingCode: (phone: string) => Promise<void>;
  /** Drop the current code and go back to the number entry. */
  clearPairing: () => void;
}

export function useWhatsAppConnect(enabled: boolean): WhatsAppConnectState {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tenantless, setTenantless] = useState(false);
  const [pairingIdle, setPairingIdle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pairing, setPairing] = useState<PairingCodeInfo | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

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

  /**
   * Ask for a fresh QR code.
   *
   * `/connect` clears the stored credentials before reconnecting, which is what
   * forces WhatsApp to issue a new code rather than silently resuming a
   * half-finished pairing — and it resets the server's QR-cycle budget, so a
   * session that had given up starts offering codes again.
   */
  const refreshQr = useCallback(async () => {
    setRefreshing(true);
    setPairingIdle(false);
    setQrCode(null);
    // `/connect` tears the socket down, and a pairing code is bound to the
    // socket that issued it — keeping it on screen would show a code that is
    // already dead.
    setPairing(null);
    setCodeError(null);
    initiatedRef.current = true;
    try {
      await beginConnect();
    } finally {
      setRefreshing(false);
    }
  }, [beginConnect]);

  /**
   * Link by phone number instead of by QR.
   *
   * You cannot scan a QR code with the screen displaying it, so on a phone the
   * scan route has no path to completion at all. This asks WhatsApp for the
   * 8-character code the user types into Linked devices instead.
   */
  const requestPairingCode = useCallback(async (phone: string) => {
    setRequestingCode(true);
    setCodeError(null);
    // Claim the handshake so the status poll doesn't helpfully "reconnect" and
    // destroy the socket the code is about to be bound to.
    initiatedRef.current = true;
    try {
      const data = await api.post('/api/whatsapp/pairing-code', { phone });
      setPairing(data);
      setQrCode(null);
      setPairingIdle(false);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'pairing_code_failed');
    } finally {
      setRequestingCode(false);
    }
  }, []);

  const clearPairing = useCallback(() => {
    setPairing(null);
    setCodeError(null);
  }, []);

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
      setPairingIdle(Boolean(data.pairingIdle));
      // The server owns the code's lifetime — it dies with the socket that
      // issued it — so this is a mirror, not a merge.
      setPairing(data.pairing ?? null);

      if (next === 'connected') {
        initiatedRef.current = false;
        setPairingIdle(false);
        setQrCode(null);
        setPairing(null);
        return;
      }

      // A code is on screen and someone is typing it into their phone. Starting
      // a handshake now would clear the credentials it is bound to and silently
      // invalidate it mid-entry.
      if (data.pairing) return;
      // Pairing has given up. Re-connecting on our own here would restart the
      // very loop the server's cycle cap exists to stop — and an unattended tab
      // would sit there re-pairing until WhatsApp rate-limits the IP, after which
      // scans silently stop working. Wait for the user to ask.
      if (data.pairingIdle) {
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
  useSocket('wa:pairing-code', () => { if (enabled) fetchStatus(); });

  // Fallback poll while waiting. Backs right off once pairing has gone idle —
  // there is nothing new to discover until the user asks for a fresh code.
  useEffect(() => {
    if (!enabled || status === 'connected') return;
    const id = setInterval(() => { fetchStatus(); }, pairingIdle ? 15000 : 4000);
    return () => clearInterval(id);
  }, [enabled, status, pairingIdle, fetchStatus]);

  return {
    status, connectedPhone, qrCode, error, tenantless, pairingIdle, refreshing, refreshQr,
    pairing, requestingCode, codeError, requestPairingCode, clearPairing,
  };
}
