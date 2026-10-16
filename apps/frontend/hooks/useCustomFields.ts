'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { CustomFieldDefinition } from '../lib/custom-fields';
import { useLiveData } from './useLiveData';

/**
 * Custom-field definitions are read on nearly every contact surface (form,
 * profile, filters, import mapping). They change rarely, so the list is cached
 * per module and shared across mounts; a mutation broadcasts to every subscriber
 * rather than leaving stale copies behind in other panels.
 */

let cache: CustomFieldDefinition[] | null = null;
let inflight: Promise<CustomFieldDefinition[]> | null = null;
const subscribers = new Set<(definitions: CustomFieldDefinition[]) => void>();

function publish(definitions: CustomFieldDefinition[]) {
  cache = definitions;
  subscribers.forEach((notify) => notify(definitions));
}

async function fetchDefinitions(includeInactive: boolean): Promise<CustomFieldDefinition[]> {
  const query = includeInactive ? '?includeInactive=true' : '';
  const data = await api.get<CustomFieldDefinition[]>(`/api/custom-fields${query}`);
  return Array.isArray(data) ? data : [];
}

/** Force every mounted consumer to re-read. Call after a create/update/delete. */
export async function refreshCustomFields(includeInactive = false) {
  const definitions = await fetchDefinitions(includeInactive);
  publish(definitions);
  return definitions;
}

export function useCustomFields(options: { includeInactive?: boolean } = {}) {
  const includeInactive = options.includeInactive ?? false;
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Dedupe the burst of parallel mounts a contacts page produces.
      if (!inflight) inflight = fetchDefinitions(includeInactive).finally(() => { inflight = null; });
      publish(await inflight);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load custom fields');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);
  useLiveData('custom-fields', load);

  useEffect(() => {
    subscribers.add(setDefinitions);
    return () => { subscribers.delete(setDefinitions); };
  }, []);

  useEffect(() => {
    // An inactive-inclusive caller (the settings page) always refetches, because
    // the shared cache may hold the active-only list.
    if (cache === null || includeInactive) void load();
    else setLoading(false);
  }, [load, includeInactive]);

  return { definitions, loading, error, reload: load };
}
