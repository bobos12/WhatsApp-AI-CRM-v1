import { useEffect, useRef } from 'react';
import socket from '../lib/socket';

/**
 * Keep a screen's data current without the user refreshing.
 *
 * Calls `refetch` when the server announces a change to one of `resources`
 * (`data:changed`, sent for every create/update/delete and for background work
 * such as a campaign finishing or Meta approving a template). It also catches up
 * on anything missed: when the live connection comes back, and when the tab or
 * app returns to the foreground — phones drop the connection while asleep.
 *
 * `refetch` must update quietly (no skeleton): it can run at any moment while
 * the user is reading the screen. Bursts are collapsed into one call.
 */
export function useLiveData(
  resources: string | string[],
  refetch: () => void,
  { id, debounceMs = 250 }: { id?: string | null; debounceMs?: number } = {},
) {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const key = Array.isArray(resources) ? resources.join(',') : resources;

  useEffect(() => {
    const watched = new Set(key.split(','));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hiddenAt = 0;

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refetchRef.current();
      }, debounceMs);
    };

    const onChange = (event: { resource?: string; id?: string | null }) => {
      if (!event?.resource || !watched.has(event.resource)) return;
      // A change to another record of the same kind doesn't concern a detail page.
      if (id && event.id && event.id !== id) return;
      schedule();
    };

    // Skip the very first connect: the screen has just loaded its data.
    let connectedOnce = socket.connected;
    const onConnect = () => {
      if (connectedOnce) schedule();
      connectedOnce = true;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 5_000) {
        schedule();
      }
    };

    socket.on('data:changed', onChange);
    socket.on('connect', onConnect);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('data:changed', onChange);
      socket.off('connect', onConnect);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key, id, debounceMs]);
}
