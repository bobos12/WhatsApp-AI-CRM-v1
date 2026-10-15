'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../lib/socket';
import { api } from '../lib/api';
import { useMessagingStore } from '../stores/messaging-store';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

interface SyncStatus {
  connection: ConnectionState;
  syncing: boolean;
  lastSynced: Date | null;
  sync: () => Promise<void>;
}

let autoSyncScheduled = false;

export function useSyncStatus(): SyncStatus {
  // Always start as 'connecting' so server and client first renders match.
  // A useEffect reads the real socket state after hydration.
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const syncingRef = useRef(false);

  // Track the real WhatsApp connection state — NOT the socket.io transport.
  // The socket pipe is up whenever the browser can reach the backend, so using
  // it here would show "connected" even when WhatsApp itself is logged out.
  // Source of truth: GET /api/whatsapp/status, kept live via the backend's
  // global `wa:status` broadcast. Runs only on the client, after hydration.
  useEffect(() => {
    let cancelled = false;

    const fetchWaStatus = async () => {
      try {
        const data = await api.get<{ status?: ConnectionState }>('/api/whatsapp/status');
        if (!cancelled && data?.status) setConnection(data.status);
      } catch {
        if (!cancelled) setConnection('disconnected');
      }
    };

    // Real WhatsApp status pushed by the backend (connected/connecting/disconnected).
    const onWaStatus = (payload: { status?: ConnectionState }) => {
      if (payload?.status) setConnection(payload.status);
    };
    // When the socket transport (re)connects we may have missed a wa:status
    // event while offline — re-fetch the authoritative status to catch up.
    const onTransportUp = () => { void fetchWaStatus(); };

    void fetchWaStatus();

    socket.on('wa:status', onWaStatus);
    socket.on('connect',   onTransportUp);
    socket.on('reconnect', onTransportUp);

    // Safety-net poll: the REST endpoint is authoritative if an event is dropped.
    const interval = setInterval(() => { void fetchWaStatus(); }, 60 * 1000);

    return () => {
      cancelled = true;
      socket.off('wa:status', onWaStatus);
      socket.off('connect',   onTransportUp);
      socket.off('reconnect', onTransportUp);
      clearInterval(interval);
    };
  }, []);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      // 1. Re-fetch conversations from API and re-seed the store
      const data = await api.get('/api/conversations');
      if (Array.isArray(data)) {
        useMessagingStore.getState().seedConversations(data);
      }

      // 2. Ask the socket server for any events we may have missed
      const lastSeq = useMessagingStore.getState().lastSeenSeq;
      if (socket.connected) {
        socket.emit('resync', { fromSeq: lastSeq, limit: 500 });
      } else {
        socket.connect();
      }

      setLastSynced(new Date());
    } catch {
      // silently fail — user can retry
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Auto-sync once shortly after mount so the header shows a real lastSynced
  // time. Deferred to idle: this fetches the FULL conversation list, and firing
  // it immediately on cold start competes with the visible screen's critical
  // requests. Real-time socket events cover the gap until it runs.
  //
  // Once per app session, not once per component: two surfaces use this hook,
  // and each used to download the whole conversation list on every page load.
  useEffect(() => {
    if (autoSyncScheduled) return;
    autoSyncScheduled = true;
    let fired = false;
    const run = () => { fired = true; void sync(); };
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const id = hasIdle
      ? window.requestIdleCallback(run, { timeout: 4000 })
      : window.setTimeout(run, 2500);
    return () => {
      if (hasIdle) window.cancelIdleCallback(id);
      else window.clearTimeout(id);
      // Unmounted before it ran (e.g. the phone header hides on the inbox): let
      // the next instance schedule it instead of skipping the sync entirely.
      if (!fired) autoSyncScheduled = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connection, syncing, lastSynced, sync };
}
