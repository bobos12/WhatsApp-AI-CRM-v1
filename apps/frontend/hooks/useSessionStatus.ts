'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useSocket } from './useSocket';

export interface WarmupInfo {
  active: boolean;
  phaseName: 'new' | 'growing' | 'maturing' | 'established';
  dailyLimit: number | null;
  dailySent: number;
  dailyRemaining: number | null;
  fullyUnlockedAt: string | null;
  perMinuteCap: number;
}

export interface SessionInfo {
  createdAt: string | null;
  dayNumber: number;
  /**
   * Whether the operator switched warm-up on. The server already folds this into
   * `warmup.active`, but consumers should check it too — a disabled warm-up must
   * never surface a ramp or a daily limit, because nothing enforces them.
   */
  warmupEnabled: boolean;
  warmup: WarmupInfo;
}

export interface SessionStatusData {
  status: 'connected' | 'disconnected' | 'connecting';
  connectedPhone: string | null;
  session: SessionInfo | null;
}

/**
 * Hook to fetch and subscribe to WhatsApp session status and warm-up phase.
 * Polls every 60 seconds and also updates via socket events.
 */
export function useSessionStatus() {
  const [data, setData] = useState<SessionStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.get<SessionStatusData>('/api/whatsapp/status');
      setData(response);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session status');
      console.error('useSessionStatus fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch (only once on mount)
  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchStatus();
    }
  }, []);

  // Poll every 60 seconds (don't re-run on fetchStatus change)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen to socket events for real-time updates
  useSocket('crm:event', (event: any) => {
    if (event?.type === 'provider.status_changed') {
      // Update with new status from socket
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: event.payload?.status || prev.status,
          connectedPhone: event.payload?.connectedPhone || prev.connectedPhone,
          // If the event includes session info, update it too
          ...(event.payload?.session ? { session: event.payload.session } : {}),
        };
      });
    }
  });

  // Real-time WhatsApp status updates (instant banner dismiss on connect)
  useSocket('wa:status', () => {
    fetchStatus();
  });

  return {
    ...data,
    isLoading,
    error,
    refetch: fetchStatus,
  };
}
