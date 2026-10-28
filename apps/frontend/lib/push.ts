import { api } from './api';

/** VAPID public keys are URL-safe base64 — convert to the Uint8Array the
 * PushManager expects for applicationServerKey. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Where this device stands for phone/desktop alerts:
 * - supported      — can subscribe right here
 * - ios-install    — iPhone/iPad in a Safari tab: push only works from the Home Screen app
 * - unsupported    — no Web Push in this browser
 */
export type PushSupport = 'supported' | 'ios-install' | 'unsupported';

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS() && !isStandalone()) return 'ios-install';
  return hasApi ? 'supported' : 'unsupported';
}

export function permission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// The key is baked into the build (NEXT_PUBLIC_VAPID_PUBLIC_KEY); asking the
// server is the fallback for builds made without it.
let serverInfo: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
async function publicKey(): Promise<string | null> {
  const built = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (built) return built;
  serverInfo ??= api.get<{ enabled: boolean; publicKey: string | null }>('/api/push/public-key').catch(() => {
    serverInfo = null;
    return { enabled: false, publicKey: null };
  });
  const info = await serverInfo;
  return info.enabled ? info.publicKey : null;
}

/** Is push configured at all? (No key anywhere → nothing to offer.) */
export async function pushAvailable(): Promise<boolean> {
  return Boolean(await publicKey());
}

function currentLocale(): 'en' | 'ar' {
  try {
    return window.localStorage.getItem('crm-lang') === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // `ready` never settles when no worker is registered (e.g. a dev server).
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 8000)),
  ]);
  return reg;
}

async function browserSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function subscribeAndRegister(): Promise<boolean> {
  const key = await publicKey();
  if (!key) return false;
  const reg = await registration();
  if (!reg) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }
  await api.post('/api/push/subscribe', { subscription: sub.toJSON(), locale: currentLocale() });
  lastSynced = syncKey(sub.endpoint);
  return true;
}

/**
 * Turn alerts on for this device. Must be called straight from a tap: the
 * permission prompt is requested before anything else is awaited, because
 * Safari only shows it while the tap is still "fresh".
 */
export async function enablePush(): Promise<'on' | 'denied' | 'failed'> {
  if (pushSupport() !== 'supported') return 'failed';
  const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (result !== 'granted') return result === 'denied' ? 'denied' : 'failed';
  try {
    return (await subscribeAndRegister()) ? 'on' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function disablePush(): Promise<void> {
  const sub = await browserSubscription().catch(() => null);
  if (!sub) return;
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  lastSynced = null;
}

/**
 * Signing out releases the device, so a phone left signed out never shows
 * customer messages on its lock screen. The next sign-in re-links it silently.
 */
export async function releaseDeviceAndSignOut(signOut: () => unknown): Promise<void> {
  await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  await signOut();
}

/** True when this browser is subscribed AND the server has it under the signed-in user. */
export async function isDeviceOn(): Promise<{ on: boolean; otherDevices: number }> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return { on: false, otherDevices: 0 };
  const sub = await browserSubscription().catch(() => null);
  const status = await api
    .post<{ registered: boolean; devices: number }>('/api/push/status', { endpoint: sub?.endpoint ?? null })
    .catch(() => ({ registered: false, devices: 0 }));
  return { on: Boolean(sub) && status.registered, otherDevices: Math.max(0, status.devices - (status.registered ? 1 : 0)) };
}

let lastSynced: string | null = null;
let syncing: Promise<void> | null = null;
let syncedUser: string | null = null;
const syncKey = (endpoint: string) => `${syncedUser}|${currentLocale()}|${endpoint}`;

/**
 * Keep this device pointed at whoever is signed in, in their language. Silent:
 * only acts once permission was already granted. Safe to call on every load,
 * sign-in and language change.
 */
export function syncPushSubscription(userId: string | null | undefined): Promise<void> {
  if (!userId || typeof window === 'undefined') return Promise.resolve();
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return Promise.resolve();
  syncedUser = userId;
  syncing ??= (async () => {
    try {
      const sub = await browserSubscription();
      if (sub && lastSynced === syncKey(sub.endpoint)) return;
      await subscribeAndRegister();
    } catch {
      /* best-effort — retried on the next load */
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
