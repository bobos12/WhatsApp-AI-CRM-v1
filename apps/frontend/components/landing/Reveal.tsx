'use client'

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  /** Stagger delay in ms */
  delay?: number
  className?: string
  as?: ElementType
  /** Render once visible and never re-hide */
  once?: boolean
}

/**
 * Lightweight scroll-reveal wrapper (fade + rise) driven by
 * IntersectionObserver. No animation library, RTL-safe (translateY only),
 * and fully disabled under prefers-reduced-motion via CSS.
 */
export default function Reveal({
  children,
  delay = 0,
  className = '',
  as,
  once = true,
}: RevealProps) {
  const Tag = (as ?? 'div') as ElementType
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          if (once) observer.unobserve(entry.target)
        } else if (!once) {
          setVisible(false)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [once])

  return (
    <Tag
      ref={ref}
      className={`nx-reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  )
}
