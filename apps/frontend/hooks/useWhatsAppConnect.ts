'use client';

/**
 * The app's single source of truth for "is WhatsApp connected".
 *
 * This used to run a pairing handshake: POST /connect, poll for a QR, refresh it
 * over sockets, and manage a rotating code the user photographed with their
 * phone. None of that exists on the official Cloud API — a number is registered
 * to a WhatsApp Business Account and this CRM talks to it with credentials, so
 * "connected" is simply whether those credentials work.
 *
 * What remains is a cheap status poll, shared app-wide through
 * WhatsAppConnectProvider so a dozen surfaces don't each open their own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import socket from '../lib/socket';

export type WaStatus = 'connected' | 'disconnected' | 'connecting';

export type QualityRating = 'UNKNOWN' | 'GREEN' | 'YELLOW' | 'RED';

export interface ChannelHealth {
  qualityRating: QualityRating;
  /** Meta's cap on unique customers you may start conversations with per 24h. */
  messagingLimit: string | null;
  restrictedUntil: string | null;
}

export interface WhatsAppConnectState {
  status: WaStatus | null;
  /** The business number in display form, once Meta confirms it. */
  connectedPhone: string | null;
  /** The display name Meta approved for the business. */
  verifiedName: string | null;
  /** True once credentials are stored, even if they currently fail. */
  configured: boolean;
  /** Meta's own health signals for the number. */
  health: ChannelHealth | null;
  error: string | null;
  /** True for the platform operator, who has no number of their own. */
  tenantless: boolean;
  /** True while a status read is in flight. */
  refreshing: boolean;
  /** True once one status read has succeeded — until then `configured` means nothing. */
  loaded: boolean;
  /** True when the server could not be reached at all (as opposed to "not connected"). */
  unreachable: boolean;
  /** Re-read status now — call after finishing the connect wizard. */
  refresh: () => Promise<void>;
}

/** Slow poll: channel state changes when a human edits Settings, not per-second. */
const POLL_MS = 60_000;

export function useWhatsAppConnect(enabled: boolean): WhatsAppConnectState {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [health, setHealth] = useState<ChannelHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tenantless, setTenantless] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  // Guards against a slow response from a previous poll overwriting a newer one.
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const seq = ++requestSeq.current;
    setRefreshing(true);
    try {
      const data = await api.get('/api/whatsapp/status');
      if (seq !== requestSeq.current) return;

      setStatus((data.status as WaStatus) ?? 'disconnected');
      setConnectedPhone(data.connectedPhone ?? null);
      setVerifiedName(data.verifiedName ?? null);
      setConfigured(Boolean(data.configured));
      setHealth(data.health ?? null);
      setTenantless(Boolean(data.tenantless));
      setError(data.error?.message ?? data.lastSyncError ?? null);
      setLoaded(true);
      setUnreachable(false);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setStatus('disconnected');
      setError(err instanceof Error ? err.message : 'status_failed');
      setUnreachable(true);
    } finally {
      if (seq === requestSeq.current) setRefreshing(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  // Meta pushes quality and restriction changes over the webhook, which the
  // backend relays. Those are the only events that change this state without a
  // user action, so listening beats shortening the poll.
  useEffect(() => {
    if (!enabled) return;
    const onChange = () => void refresh();
    socket.on('wa:quality_update', onChange);
    socket.on('wa:account_update', onChange);
    return () => {
      socket.off('wa:quality_update', onChange);
      socket.off('wa:account_update', onChange);
    };
  }, [enabled, refresh]);

  return {
    status,
    connectedPhone,
    verifiedName,
    configured,
    health,
    error,
    tenantless,
    refreshing,
    loaded,
    unreachable,
    refresh,
  };
}
