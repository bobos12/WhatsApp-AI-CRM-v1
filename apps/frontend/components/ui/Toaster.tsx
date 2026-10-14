'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore, type Toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

// ── Static icons per type ─────────────────────────────────────────────────────
const ICONS = {
  success: CheckCircle2,
  error:   AlertCircle,
  info:    Info,
  warning: AlertTriangle,
  message: null,
} as const;

// ── ToastShell: gives the static analyser literal role strings ────────────────
interface ShellProps {
  children: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  'data-tf-card': '';
  'data-tf-type': string;
  'data-from-top': 'true' | 'false';
  'data-exiting'?: '';
  style: React.CSSProperties;
}

function ToastShell({ isError, ...rest }: ShellProps & { isError: boolean }) {
  if (isError) return <div role="alert"  aria-live="assertive" {...rest} />;
  return           <div role="status" aria-live="polite"     {...rest} />;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

  return (
    <div className="tf-avatar flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-[13px] font-black tracking-tight text-slate-950">
      {initials}
    </div>
  );
}

// ── Single toast card ─────────────────────────────────────────────────────────
function ToastItem({
  toast,
  onRemove,
  fromTop,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
  fromTop: boolean;
}) {
  const [exiting, setExiting] = useState(false);
  const router = useRouter();
  const duration = toast.duration ?? 4500;
  const clickable = !!toast.href;
  const isMessage = toast.type === 'message';
  const IconComp = ICONS[toast.type];

  // Start exit animation just before the store auto-removes
  useEffect(() => {
    if (duration < 400) return;
    const id = setTimeout(() => setExiting(true), duration - 350);
    return () => clearTimeout(id);
  }, [duration]);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => onRemove(toast.id), 340);
  };

  const handleClick = () => {
    if (!clickable) return;
    router.push(toast.href!);
    dismiss();
  };

  return (
    <ToastShell
      isError={toast.type === 'error'}
      data-tf-card=""
      data-tf-type={toast.type}
      data-from-top={fromTop ? 'true' : 'false'}
      {...(exiting ? { 'data-exiting': '' } : {})}
      onClick={clickable ? handleClick : undefined}
      style={{ '--tf-dur': `${duration}ms` } as React.CSSProperties}
      className={cn(
        'relative w-full overflow-hidden rounded-xl backdrop-blur-2xl',
        'bg-white/[0.97] dark:bg-[#161D22]/[0.94]',
        'border border-black/[0.06] dark:border-white/[0.07]',
        'shadow-[0_8px_40px_rgba(0,0,0,0.13),_0_1px_0_rgba(0,0,0,0.04)]',
        'dark:shadow-[0_12px_48px_rgba(0,0,0,0.55),_0_1px_0_rgba(255,255,255,0.05)_inset]',
        clickable && 'cursor-pointer',
      )}
    >
      {/* Top-edge shimmer */}
      <div className="tf-shimmer pointer-events-none absolute inset-x-0 top-0 h-px" />

      {/* Left accent bar */}
      <div className="tf-bar absolute start-0 top-[10%] h-[80%] w-[3.5px] rounded-full" />

      {/* Content row */}
      <div className="flex items-center gap-3 px-4 py-3.5 ps-[18px]">

        {/* Left graphic */}
        {isMessage && toast.title ? (
          <Avatar name={toast.title} />
        ) : IconComp ? (
          <div className="tf-icon-wrap flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
            <IconComp className="h-4 w-4" />
          </div>
        ) : null}

        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {toast.title && (
              <p dir="auto" className="truncate text-[13.5px] font-bold leading-snug text-ink">
                {toast.title}
              </p>
            )}
            {isMessage && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-300 dark:text-white/20">
                WhatsApp
              </span>
            )}
          </div>
          <p className="mt-[3px] line-clamp-2 text-[12.5px] leading-[1.4] text-gray-500 dark:text-white/55">
            {toast.message}
          </p>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          aria-label="Dismiss"
          className={cn(
            'ms-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            'bg-black/[0.04] text-gray-400 hover:bg-black/[0.08] hover:text-gray-700',
            'dark:bg-white/[0.05] dark:text-white/25 dark:hover:bg-white/[0.1] dark:hover:text-white/60',
            'transition-colors',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Countdown progress bar */}
      <div className="absolute bottom-0 start-[3.5px] end-0 h-[2.5px] overflow-hidden rounded-full bg-black/[0.04] dark:bg-white/[0.05]">
        <div className="tf-prog-fill" />
      </div>
    </ToastShell>
  );
}

// ── Root container ────────────────────────────────────────────────────────────
export default function Toaster() {
  const { toasts, remove } = useToastStore();
  const [isMobile, setIsMobile] = useState(false);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!toasts.length) return null;

  return (
    <div
      aria-label="Notifications"
      className={cn(
        'pointer-events-none fixed z-[300] flex flex-col gap-2.5',
        isMobile
          ? 'inset-x-0 top-3 items-center px-4'
          : 'bottom-6 end-6 w-full max-w-[360px]',
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto',
            isMobile ? 'w-full max-w-[440px]' : 'w-full',
          )}
        >
          <ToastItem toast={toast} onRemove={remove} fromTop={isMobile} />
        </div>
      ))}
    </div>
  );
}
