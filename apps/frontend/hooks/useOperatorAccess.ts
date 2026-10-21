'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api } from '../lib/api';

/**
 * Whether the current user may use the platform (operator) console. Resolved by
 * the backend (`GET /api/platform/access`), which returns true for the
 * PLATFORM_OWNER role and the developer super-account. Used to gate the platform
 * nav item and the /platform page. `isOwner` marks the protected platform owner.
 */
export function useOperatorAccess(): { isOperator: boolean; isOwner: boolean; loading: boolean } {
  const { status } = useSession();
  const [isOperator, setIsOperator] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      setIsOperator(false);
      setIsOwner(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ isOperator: boolean; isOwner?: boolean }>('/api/platform/access')
      .then((r) => { if (!cancelled) { setIsOperator(Boolean(r?.isOperator)); setIsOwner(Boolean(r?.isOwner)); } })
      .catch(() => { if (!cancelled) { setIsOperator(false); setIsOwner(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  return { isOperator, isOwner, loading };
}
