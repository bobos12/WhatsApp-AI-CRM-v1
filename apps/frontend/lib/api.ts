import { getSession } from 'next-auth/react';
import type { Session } from 'next-auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// getSession() is a network round-trip to /api/auth/session. Without a cache,
// every api.* call pays that tax — a dashboard load fires 6+ requests and each
// re-fetched the session. Cache it briefly (well under the 15m access-token TTL)
// and dedupe concurrent callers so a burst of parallel requests shares one fetch.
const SESSION_CACHE_MS = 30_000;
let cachedSession: Session | null = null;
let cachedSessionAt = 0;
let inflightSession: Promise<Session | null> | null = null;

async function getCachedSession(): Promise<Session | null> {
  if (cachedSession && Date.now() - cachedSessionAt < SESSION_CACHE_MS) return cachedSession;
  if (!inflightSession) {
    inflightSession = getSession()
      .then((session) => {
        cachedSession = session;
        cachedSessionAt = Date.now();
        return session;
      })
      .finally(() => { inflightSession = null; });
  }
  return inflightSession;
}

/** Drop the cached session (e.g. after a 401 — the token it holds is stale). */
export function invalidateSessionCache() {
  cachedSession = null;
  cachedSessionAt = 0;
}

/** Key under which the platform operator's "view as client" token is stored. */
export const IMPERSONATION_TOKEN_KEY = 'impersonationToken';
const IMPERSONATION_LABEL_KEY = 'impersonationLabel';

/** True while the operator is impersonating a tenant (viewing the app as them). */
export function isImpersonating(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage.getItem(IMPERSONATION_TOKEN_KEY);
}

/** The impersonated client's display name, if any. */
export function getImpersonationLabel(): string | null {
  return typeof window !== 'undefined' ? window.localStorage.getItem(IMPERSONATION_LABEL_KEY) : null;
}

/** Begin impersonation: subsequent API calls use this tenant-scoped token. */
export function startImpersonation(token: string, label?: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
    if (label) window.localStorage.setItem(IMPERSONATION_LABEL_KEY, label);
  }
  invalidateSessionCache();
}

/** End impersonation and return to the operator's own session. */
export function stopImpersonation() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(IMPERSONATION_TOKEN_KEY);
    window.localStorage.removeItem(IMPERSONATION_LABEL_KEY);
  }
  invalidateSessionCache();
}

async function getAccessToken() {
  // When impersonating, the tenant-scoped token wins over the operator's own
  // session so every request is fenced to the impersonated tenant.
  if (typeof window !== 'undefined') {
    const imp = window.localStorage.getItem(IMPERSONATION_TOKEN_KEY);
    if (imp) return imp;
  }
  const session = await getCachedSession();
  return session?.accessToken || (typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null);
}

async function getRefreshToken() {
  const session = await getCachedSession();
  return session?.refreshToken || (typeof window !== 'undefined' ? window.localStorage.getItem('refreshToken') : null);
}

async function refreshAccessToken() {
  try {
    invalidateSessionCache(); // the cached session's access token just failed
    const refreshToken = await getRefreshToken();
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: refreshToken ? { Authorization: `Bearer ${refreshToken}` } : {},
    });

    if (!response.ok) return null;

    const data = await response.json().catch(() => null);
    return data?.token || null;
  } catch {
    return null;
  }
}

async function getValidAccessToken() {
  const token = await getAccessToken();
  if (token) return token;

  const refreshed = await refreshAccessToken();
  if (refreshed && typeof window !== 'undefined') {
    window.localStorage.setItem('accessToken', refreshed);
  }
  return refreshed;
}

export async function apiRequest(endpoint: string, options: RequestInit = {}, retry = true) {
  const token = await getValidAccessToken();
  const config: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  let response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  // While impersonating we must never refresh into the operator's own token —
  // that would switch the request back to platform scope. Let it fail instead.
  if (retry && !isImpersonating() && (response.status === 401 || response.status === 403)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('accessToken', newToken);
      }

      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...config,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
          ...options.headers,
        },
      });
    } else if (typeof window !== 'undefined') {
      window.localStorage.removeItem('accessToken');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      throw new Error(errorData?.error || 'Authentication required');
    }
    const error = new Error(errorData?.error || `API request failed: ${response.statusText}`);
    (error as any).status = response.status;
    (error as any).data = errorData;
    throw error;
  }

  return response.json();
}

export async function apiForm(endpoint: string, formData: FormData, retry = true) {
  const token = await getAccessToken();
  let response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (retry && (response.status === 401 || response.status === 403)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('accessToken', newToken);
      }
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: { Authorization: `Bearer ${newToken}` },
      });
    } else if (typeof window !== 'undefined') {
      window.localStorage.removeItem('accessToken');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const error = new Error(errorData?.error || `API request failed: ${response.statusText}`);
    (error as any).status = response.status;
    (error as any).data = errorData;
    throw error;
  }

  return response.json();
}

export const api = {
  get: <T = any>(endpoint: string): Promise<T> => apiRequest(endpoint),
  post: <T = any>(endpoint: string, data: any): Promise<T> => apiRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  put: <T = any>(endpoint: string, data: any): Promise<T> => apiRequest(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  patch: <T = any>(endpoint: string, data: any): Promise<T> => apiRequest(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  delete: <T = any>(endpoint: string): Promise<T> => apiRequest(endpoint, {
    method: 'DELETE',
  }),
};
