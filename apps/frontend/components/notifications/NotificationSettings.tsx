'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellOff, BellRing, Loader2, Send, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/page';
import { useToast } from '@/hooks/useToast';
import {
  disablePush, enablePush, isDeviceOn, permission, pushAvailable, pushSupport,
} from '@/lib/push';

const CATEGORIES = ['messages', 'assignments', 'mentions', 'comments', 'reviews', 'deadlines', 'reminders'] as const;

type DeviceState = 'loading' | 'on' | 'off' | 'blocked' | 'unsupported' | 'ios-install' | 'server-off';

/** Settings → Notifications: this device on/off, what to hear about, and a test. */
export default function NotificationSettings() {
  const { t } = useTranslation('settings');
  const { success, error: toastError, info } = useToast();
  const [device, setDevice] = useState<DeviceState>('loading');
  const [others, setOthers] = useState(0);
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);

  const readDevice = useCallback(async () => {
    const support = pushSupport();
    if (support === 'unsupported') return setDevice('unsupported');
    if (!(await pushAvailable())) return setDevice('server-off');
    if (support === 'ios-install') return setDevice('ios-install');
    if (permission() === 'denied') return setDevice('blocked');
    const s = await isDeviceOn();
    setOthers(s.otherDevices);
    setDevice(s.on ? 'on' : 'off');
  }, []);

  useEffect(() => {
    void readDevice();
    api.get<{ off: string[] }>('/api/notifications/preferences')
      .then((p) => setOff(new Set(p.off)))
      .catch(() => {});
  }, [readDevice]);

  const toggleDevice = async () => {
    setBusy(true);
    try {
      if (device === 'on') await disablePush();
      else if ((await enablePush()) === 'failed') toastError(t('saveFailed'));
    } finally {
      await readDevice();
      setBusy(false);
    }
  };

  const toggleCategory = async (key: string, enabled: boolean) => {
    const next = new Set(off);
    if (enabled) next.delete(key); else next.add(key);
    setOff(next);
    try {
      await api.put('/api/notifications/preferences', { off: [...next] });
    } catch {
      setOff(off);
      toastError(t('notify.saveFailed'));
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api.post('/api/notifications/test', {});
      if (device === 'on') success(t('notify.test.sent'));
      else info(t('notify.test.sentNoDevice'));
    } catch {
      toastError(t('notify.test.failed'));
    } finally {
      setTesting(false);
    }
  };

  const statusText: Record<Exclude<DeviceState, 'loading'>, string> = {
    on: t('notify.device.on'),
    off: t('notify.device.off'),
    blocked: t('notify.device.blocked'),
    unsupported: t('notify.device.unsupported'),
    'ios-install': t('notify.device.needsInstall'),
    'server-off': t('notify.device.serverOff'),
  };
  const canToggle = device === 'on' || device === 'off';

  return (
    <div className="space-y-6">
      {/* This device */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-base',
            device === 'on' ? 'bg-brand/10 text-brand' : 'bg-raised text-ink-3',
          )}
        >
          {device === 'on' ? <BellRing className="h-5 w-5" /> : device === 'loading' ? <Smartphone className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink">{t('notify.device.label')}</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-3">
            {device === 'loading' ? '…' : statusText[device]}
            {device === 'on' && others > 0 && ` ${t('notify.device.otherDevices', { count: others })}`}
          </p>
        </div>
        {canToggle && (
          <Button
            variant={device === 'on' ? 'secondary' : 'primary'}
            size="sm"
            onClick={toggleDevice}
            disabled={busy}
            className="gap-1.5"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {device === 'on' ? t('notify.device.turnOff') : t('notify.device.turnOn')}
          </Button>
        )}
      </section>

      {/* Categories */}
      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-4">
          {t('notify.categories.title')}
        </h3>
        <div className="divide-y divide-line">
          {CATEGORIES.map((key) => {
            const enabled = !off.has(key);
            return (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{t(`notify.categories.${key}.label`)}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-3">{t(`notify.categories.${key}.hint`)}</span>
                </span>
                <Switch
                  checked={enabled}
                  onChange={(next) => void toggleCategory(key, next)}
                  label={t(`notify.categories.${key}.label`)}
                />
              </label>
            );
          })}
        </div>
      </section>

      {/* Test */}
      <div className="flex items-center gap-3 border-t border-line pt-5">
        <Button variant="secondary" onClick={sendTest} disabled={testing} className="gap-2">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {testing ? t('notify.test.sending') : t('notify.test.button')}
        </Button>
      </div>
    </div>
  );
}
