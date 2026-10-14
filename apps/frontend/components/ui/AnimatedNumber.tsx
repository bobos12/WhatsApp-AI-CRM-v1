'use client';

import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * A figure that counts to its value on first paint and glides between values
 * when live data changes it — so an update is noticed without a flash. Text is
 * written straight to the node: no React re-render per frame.
 */
export default function AnimatedNumber({
  value,
  format,
  className,
  duration = 0.9,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = formatRef.current(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: from.current === 0 ? duration : 0.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { node.textContent = formatRef.current(Math.round(v)); },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span ref={ref} className={className}>{format(0)}</span>;
}
