'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useChatOpen } from '@/stores/chat-open-store';
import { useHeaderHidden } from '@/stores/header-hidden-store';

// Screens that own the full workspace edge to edge (their own panes, their own
// scroll). Everything else gets the standard page gutter and reading width.
const FULL_BLEED = ['/conversations'];

export default function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bleed = FULL_BLEED.some((p) => pathname?.startsWith(p));
  // Full-screen editors hide the phone app bar; the page then owns the notch area.
  const chatOpen = useChatOpen((s) => s.isOpen);
  const headerHidden = useHeaderHidden((s) => s.hidden);
  const noAppBar = chatOpen || headerHidden;

  return (
    <main
      id="main"
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-x-hidden',
        bleed ? 'overflow-hidden' : 'overflow-y-auto',
      )}
    >
      {bleed ? children : (
        <div className={cn(
          'mx-auto w-full max-w-[1480px] px-4 pb-[calc(var(--bottom-nav-space)+1.5rem)] sm:px-6 sm:pb-10 sm:pt-6 lg:px-8',
          noAppBar ? 'pt-[calc(env(safe-area-inset-top)+1.25rem)]' : 'pt-5',
        )}>
          {children}
        </div>
      )}
    </main>
  );
}
