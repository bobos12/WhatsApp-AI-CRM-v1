'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api } from '../lib/api';

/**
 * Whether the current user may use the platform (operator) console. Resolved by
 * the backend (`GET /api/platform/access`), which returns true for the
 * PLATFORM_OWNER role and the developer super-account. Used to gate the platform
 * nav item and the /platform page.
 */
export function useOperatorAccess(): { isOperator: boolean; loading: boolean } {
  const { status } = useSession();
  const [isOperator, setIsOperator] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      setIsOperator(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ isOperator: boolean }>('/api/platform/access')
      .then((r) => { if (!cancelled) setIsOperator(Boolean(r?.isOperator)); })
      .catch(() => { if (!cancelled) setIsOperator(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  return { isOperator, loading };
}
