'use client';

let audioContext: AudioContext | null = null;
let gestureReceived = false;
let audioUnlockBound = false;

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
}

/**
 * Returns the AudioContext only after a user gesture has been received.
 * Avoids the "AudioContext was not allowed to start" browser warning.
 */
function getAudioContext(): AudioContext | null {
  if (!gestureReceived) return null;
  if (!audioContext) audioContext = createAudioContext();
  return audioContext;
}

/**
 * Call once on app mount. Defers AudioContext creation until the user's first
 * click/keypress/touch so the browser autoplay policy is satisfied.
 */
export function primeNotificationSound() {
  if (typeof window === 'undefined' || audioUnlockBound) return;
  audioUnlockBound = true;
  const unlock = () => {
    gestureReceived = true;
    if (!audioContext) audioContext = createAudioContext();
    // Do NOT call resume() here — Chrome warns even inside gesture handlers.
    // A context created during a gesture starts in "running" state automatically.
  };
  window.addEventListener('pointerdown', unlock, { once: false, passive: true });
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('touchstart', unlock, { once: false, passive: true });
}

/** Play a short, WhatsApp-like notification chime using the Web Audio API */
export function playNotificationSound() {
  const ctx = getAudioContext();
  // If context isn't running (suspended or closed) just skip — no resume() call
  // to avoid the Chrome autoplay warning. Sound will play after next gesture.
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;

  const notes = [
    { freq: 1200, start: 0, duration: 0.1 },
    { freq: 880, start: 0.12, duration: 0.15 },
  ];

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.16, now + note.start);
    gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.duration);
    osc.start(now + note.start);
    osc.stop(now + note.start + note.duration + 0.05);
  }
}

/** Request browser notification permission (call once on user interaction) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** Show a browser notification. Clicking it focuses the tab and navigates to `href`. */
export function showBrowserNotification(
  title: string,
  body: string,
  options?: { icon?: string; tag?: string; href?: string },
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;

  const n = new Notification(title, {
    body,
    icon: options?.icon || '/icons/icon-192.png',
    tag: options?.tag,
    silent: true,
  });

  if (options?.href) {
    n.onclick = () => {
      try {
        window.focus();
        window.location.href = options.href!;
      } catch { /* ignore */ }
      n.close();
    };
  }
}
