'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';

/**
 * Page transition. A Next.js `template` re-mounts on every navigation (unlike
 * `layout`), so each screen arrives with a short fade and a 6px rise — enough to
 * register as "new place", short enough (≈250ms) never to feel like waiting.
 * Vertical, so it reads the same in Arabic as in English.
 *
 * Once the entrance finishes the motion wrapper is dropped for a plain div: a
 * lingering `transform` would become the containing block for any
 * `position: fixed` dialog inside the page.
 *
 * The inbox is skipped: it drives the URL (?c=<id>) on every chat switch, and a
 * full-page fade there would fire each time a conversation opens.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [entered, setEntered] = useState(false);

  const fullBleed = !!pathname?.startsWith('/conversations');
  const wrapperClass = fullBleed ? 'flex h-full min-h-0 flex-col' : 'min-h-full';

  if (reduceMotion || fullBleed || entered) return <div className={wrapperClass}>{children}</div>;

  return (
    <motion.div
      className={wrapperClass}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={() => setEntered(true)}
    >
      {children}
    </motion.div>
  );
}
