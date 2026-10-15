/**
 * Two small caches that make the CRM feel like an app instead of a website.
 *
 * 1. `cachedGet` — reference data that rarely changes (agents, teams, saved
 *    replies, templates). Fetched once, reused for a minute, and dropped the
 *    moment anything is created, edited or deleted, so it can't go stale after
 *    the user's own change. Opening a chat used to refetch all four every time.
 *
 * 2. `peek` / `remember` — the last response for a screen's own data (the inbox
 *    list, a chat's messages). A screen shows it instantly when it opens and
 *    refreshes in the background, the way a native app shows what it had and
 *    then updates, instead of a skeleton on every visit.
 */

const MAX_SCREENS = 40;

const reference = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const screens = new Map<string, unknown>();

export async function cachedGet<T>(url: string, fetcher: (url: string) => Promise<T>, maxAgeMs = 60_000): Promise<T> {
  const hit = reference.get(url);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = fetcher(url)
    .then((data) => {
      reference.set(url, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, request);
  return request;
}

/** Called after any write: whatever reference data the user just changed must be refetched. */
export function invalidateReference() {
  reference.clear();
}

export function peek<T>(key: string): T | undefined {
  return screens.get(key) as T | undefined;
}

export function remember<T>(key: string, data: T): void {
  // Re-insert so the Map's order tracks recency; the oldest screen is evicted first.
  screens.delete(key);
  screens.set(key, data);
  if (screens.size > MAX_SCREENS) screens.delete(screens.keys().next().value as string);
}

export function forget(key: string): void {
  screens.delete(key);
}

/** On sign-out: one person's inbox must never show up for the next. */
export function clearAllCaches() {
  reference.clear();
  inflight.clear();
  screens.clear();
}
