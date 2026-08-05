'use client';

/**
 * Live campaign safety analysis.
 *
 * Posts the draft to `/api/broadcasts/preflight` as the user edits and returns
 * the server's verdict. Debounced, and guarded against out-of-order responses:
 * typing into the message box fires several requests and they do not necessarily
 * land in the order they were sent — showing a stale verdict as if it were the
 * current one is worse than showing none.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { PreflightReport } from '../lib/preflight';

export interface PreflightDraft {
  message: string;
  recipients: string[];
  tag?: string;
  mediaUrl?: string;
  interactiveContent?: object;
  pacingProfile?: string;
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  pilotSize?: number | null;
  /** Server-resolved audience exclusions applied by the report's one-tap fixes. */
  excludeCold?: boolean;
  excludeReceivedFrom?: string | null;
}

const DEBOUNCE_MS = 700;

export function usePreflight(draft: PreflightDraft, options: { enabled?: boolean; excludeId?: string } = {}) {
  const enabled = options.enabled !== false;
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef(0);
  // Serialize the draft so the effect depends on its *content*, not on the
  // identity of an object literal rebuilt on every render.
  // The request body itself, serialized. Using it as the effect key means the
  // request fires exactly when something that changes the answer changes, and
  // never merely because React re-rendered.
  //
  // Memoised on the individual fields rather than recomputed every render: the
  // recipient array can hold tens of thousands of numbers, and re-serialising it
  // on every keystroke of the message box would be the most expensive thing this
  // form does. `draft.recipients` is expected to be a stable reference from the
  // caller (a useMemo), which is what makes this cheap.
  const key = useMemo(
    () =>
      JSON.stringify({
        message: draft.message,
        recipients: draft.recipients,
        tag: draft.tag || undefined,
        mediaUrl: draft.mediaUrl || undefined,
        interactiveContent: draft.interactiveContent,
        pacingProfile: draft.pacingProfile,
        quietHoursEnabled: draft.quietHoursEnabled,
        quietHoursStart: draft.quietHoursStart,
        quietHoursEnd: draft.quietHoursEnd,
        pilotSize: draft.pilotSize ?? undefined,
        excludeCold: draft.excludeCold || undefined,
        excludeReceivedFrom: draft.excludeReceivedFrom || undefined,
      }),
    [
      draft.message,
      draft.recipients,
      draft.tag,
      draft.mediaUrl,
      draft.interactiveContent,
      draft.pacingProfile,
      draft.quietHoursEnabled,
      draft.quietHoursStart,
      draft.quietHoursEnd,
      draft.pilotSize,
      draft.excludeCold,
      draft.excludeReceivedFrom,
    ],
  );

  const run = useCallback(async () => {
    const token = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api.post<PreflightReport>(
        `/api/broadcasts/preflight${options.excludeId ? `?exclude=${options.excludeId}` : ''}`,
        JSON.parse(key),
      );
      if (token !== requestRef.current) return;
      setReport(result);
      setError(null);
    } catch (err) {
      if (token !== requestRef.current) return;
      setError(err instanceof Error ? err.message : 'Could not analyse this campaign');
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
    // `key` is the real dependency; the draft fields are read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.excludeId]);

  useEffect(() => {
    // Nothing to assess — either the caller switched the analysis off, or the
    // audience is empty. Both must CLEAR the verdict, not just stop asking for a
    // new one.
    //
    // Leaving the last report on screen is how deselecting every contact left a
    // "High risk 67/100 · about 2 hours · 117/hr" panel describing an audience
    // that no longer existed. A stale verdict presented as the current one is
    // the exact failure this hook's out-of-order guard exists to prevent; it was
    // just as reachable by emptying the form as by a slow response.
    //
    // (The `enabled` branch used to return before the empty-audience branch
    // below could run, so the clear never happened for the commonest case.)
    if (!enabled || (!draft.recipients.length && !draft.tag)) {
      requestRef.current += 1; // discard anything in flight
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => void run(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, run]);

  return { report, loading, error, refresh: run };
}

/** Account health on its own, for the dashboard widget. */
export function useAccountHealth(pollMs = 0) {
  const [health, setHealth] = useState<PreflightReport['health'] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await api.get<PreflightReport['health']>('/api/broadcasts/health');
      setHealth(result);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (!pollMs) return;
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { health, loading, refresh: load };
}
