'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface ModalProps {
  /** Whether the modal is shown. When false, nothing is rendered. */
  open: boolean;
  /** Called when the user dismisses via ESC, backdrop click, or programmatically. */
  onClose: () => void;
  /** Panel contents (typically a header + body; provide your own close button if desired). */
  children: React.ReactNode;
  /**
   * Accessible name for the dialog. Provide either this or `aria-labelledby`
   * (when the panel already contains a visible heading with that id).
   */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Classes for the panel element. Defaults preserve the app's modal styling. */
  className?: string;
  /** Classes for the backdrop/overlay element. */
  overlayClassName?: string;
  /** Set false to prevent closing on backdrop click (e.g. destructive forms). Default true. */
  closeOnBackdrop?: boolean;
}

/**
 * Accessible modal dialog.
 *
 * Provides the behaviors hand-rolled modals were missing for WCAG AA:
 * - `role="dialog"` + `aria-modal` so screen readers announce and isolate it
 * - focus is moved into the dialog on open and a Tab focus-trap keeps it inside
 * - focus is restored to the triggering element on close
 * - ESC and backdrop click dismiss
 * - background scroll is locked while open
 *
 * The visual appearance is entirely controlled by `className`/`overlayClassName`
 * so existing modals keep their exact look after migration.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  overlayClassName,
  closeOnBackdrop = true,
  ...aria
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Keep the latest onClose without re-running the focus-trap effect on every
  // render (callers typically pass a fresh arrow function each render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const getFocusable = useCallback((): HTMLElement[] => {
    if (!panelRef.current) return [];
    return Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Lock background scroll.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog (first focusable, else the panel itself).
    const focusables = getFocusable();
    (focusables[0] ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = originalOverflow;
      // Restore focus to whatever opened the modal.
      previouslyFocused.current?.focus?.();
    };
  }, [open, getFocusable]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm',
        overlayClassName,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        tabIndex={-1}
        className={cn('outline-none', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
