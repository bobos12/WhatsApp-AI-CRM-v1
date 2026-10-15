'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { peek, remember } from '@/lib/api-cache';

/**
 * useState that survives leaving the screen.
 *
 * A screen opened for the second time shows what it had last time immediately,
 * then its normal fetch replaces it — no blank list and spinner on every visit,
 * which is most of what made the CRM feel like a website reloading. The value
 * lives in memory only (lib/api-cache), so a reload or sign-out starts clean.
 *
 * `isFirstLoad` is true only when nothing was remembered: use it as the initial
 * `loading` state so the skeleton appears once, never on a return visit.
 */
export function useRemembered<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [isFirstLoad] = useState(() => peek(key) === undefined);
  const [placeholder] = useState(initial);
  const [value, setValue] = useState<T>(() => peek<T>(key) ?? placeholder);

  // Only real data is remembered: leaving before the first fetch finishes must
  // not save the empty placeholder and show "nothing here" next time.
  useEffect(() => {
    if (value !== placeholder) remember(key, value);
  }, [key, value, placeholder]);

  return [value, setValue, isFirstLoad];
}
