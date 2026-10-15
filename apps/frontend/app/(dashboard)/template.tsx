'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';

/**
 * Page transition. A Next.js `template` re-mounts on every navigation (unlike
 * `layout`), so each screen settles in with a 4px rise — enough to register as
 * "new place" without the blank frame a fade-in shows.
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
      // Movement only, no fade: starting from transparent flashed a blank frame
      // on every navigation, which read as the page reloading.
      initial={{ y: 4 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={() => setEntered(true)}
    >
      {children}
    </motion.div>
  );
}
