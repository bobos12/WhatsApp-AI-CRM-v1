'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { BellRing, Check, Loader2, Share, SquarePlus, Smartphone } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { isImpersonating } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  enablePush, isDeviceOn, isIOS, permission, pushAvailable, pushSupport, syncPushSubscription,
} from '@/lib/push';

const SNOOZE_KEY = 'nx-push-later';
const SNOOZE_MS = 60 * 60 * 1000;
const SHOW_AFTER_MS = 1000;

type Mode = 'ask' | 'ios' | 'blocked';

function snoozed(): boolean {
  try {
    return Date.now() - Number(window.localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try { window.localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* private mode */ }
}

/**
 * Asks once a second after the app opens, and again an hour after "Later",
 * until this device is on. The browser's own prompt is triggered by the Allow
 * tap itself (browsers ignore it otherwise). Devices that already granted
 * permission are re-linked silently to whoever is signed in — no popup.
 */
export default function PushPrompt() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { t } = useTranslation('settings');
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');

  useEffect(() => {
    if (!userId || isImpersonating()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const support = pushSupport();
      if (support === 'unsupported' || !(await pushAvailable())) return;
      const perm = permission();

      if (support === 'supported' && perm === 'granted') {
        await syncPushSubscription(userId);
        const { on } = await isDeviceOn();
        if (on || cancelled || snoozed()) return;
        setMode('ask');
        return;
      }
      if (cancelled || snoozed()) return;
      setMode(support === 'ios-install' ? 'ios' : perm === 'denied' ? 'blocked' : 'ask');
    }, SHOW_AFTER_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId]);

  const later = () => { snooze(); setMode(null); setState('idle'); };

  const allow = async () => {
    setState('working');
    const result = await enablePush();
    if (result === 'on') {
      setState('done');
      setTimeout(() => { setMode(null); setState('idle'); }, 1100);
    } else if (result === 'denied') {
      setState('idle');
      setMode('blocked');
    } else {
      setState('idle');
      later();
    }
  };

  if (!mode) return null;

  const platform = isIOS() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
  const steps: string[] =
    mode === 'ios'
      ? (t('notify.prompt.iosSteps', { returnObjects: true }) as string[])
      : mode === 'blocked'
        ? (t(`notify.prompt.blockedSteps.${platform}`, { returnObjects: true }) as string[])
        : (t('notify.prompt.points', { returnObjects: true }) as string[]);
  const stepIcons = [Share, SquarePlus, BellRing];

  return (
    <Modal
      open
      onClose={later}
      aria-labelledby="push-prompt-title"
      overlayClassName="items-end sm:items-center bg-black/50"
      className="pop-enter w-full max-w-[400px] rounded-2xl bg-surface p-5 shadow-pop sm:p-6"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        {mode === 'ios' ? <Smartphone className="h-6 w-6" /> : <BellRing className={cn('h-6 w-6', mode === 'ask' && 'bell-ring')} />}
      </div>

      <h2 id="push-prompt-title" className="mt-4 text-[17px] font-semibold tracking-tight text-ink">
        {mode === 'ios' ? t('notify.prompt.iosTitle') : mode === 'blocked' ? t('notify.prompt.blockedTitle') : t('notify.prompt.title')}
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">
        {mode === 'ios' ? t('notify.prompt.iosBody') : mode === 'blocked' ? t('notify.prompt.blockedBody') : t('notify.prompt.body')}
      </p>

      <ol className="mt-4 space-y-2.5">
        {steps.map((step, i) => {
          const Icon = mode === 'ios' ? stepIcons[i] ?? Check : Check;
          return (
            <li key={step} className="flex items-start gap-3 text-[13px] text-ink-2">
              <span
                className={cn(
                  'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  mode === 'ask' ? 'bg-brand/10 text-brand' : 'bg-raised text-ink-2',
                )}
              >
                {mode === 'ask' ? <Check className="h-3.5 w-3.5" /> : mode === 'ios' ? <Icon className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-col gap-2">
        {mode === 'ask' ? (
          <>
            <Button size="lg" className="w-full gap-2" onClick={allow} disabled={state !== 'idle'}>
              {state === 'working' && <Loader2 className="h-4 w-4 animate-spin" />}
              {state === 'done' && <Check className="h-4 w-4" />}
              {state === 'working' ? t('notify.prompt.working') : state === 'done' ? t('notify.prompt.done') : t('notify.prompt.allow')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={later} disabled={state === 'working'}>
              {t('notify.prompt.later')}
            </Button>
          </>
        ) : (
          <Button size="lg" variant="secondary" className="w-full" onClick={later}>
            {t('notify.prompt.gotIt')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
