'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Tag } from 'lucide-react'
import type { LandingContent } from './content'

type Hero = LandingContent['hero']

/**
 * The hero's centrepiece: a customer chat that plays out on its own while the
 * CRM record beside it updates — the product's whole promise in eight seconds.
 *
 * Steps: 1 customer asks · 2 AI typing · 3 AI replies · 4 delivered ·
 * 5 read + lead qualified · 6 customer thanks · 7 handed to a salesperson.
 * Every bubble is laid out from the start (just invisible), so nothing shifts
 * while it plays. Loops only while on screen; reduced motion shows the end state.
 */
const TIMELINE = [500, 1400, 2900, 3500, 4300, 5500, 6700]
const FINAL = TIMELINE.length
const HOLD_MS = 5200

function Ticks({ step }: { step: number }) {
  return (
    <svg
      viewBox="0 0 18 12"
      aria-hidden
      className={`h-3 w-[18px] shrink-0 transition-colors duration-500 ${step >= 5 ? 'text-[#53bdeb]' : 'text-white/45'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 6.5l3.2 3.2L10.5 3" />
      <path d="M7.4 9.1l.6.6L14.3 3" className={`transition-opacity duration-300 ${step >= 4 ? 'opacity-100' : 'opacity-0'}`} />
    </svg>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--nx-line)] px-4 py-2.5 text-[13px]">
      <span className="text-[var(--nx-text-3)]">{label}</span>
      {children}
    </div>
  )
}

export default function HeroConversation({ hero }: { hero: Hero }) {
  const { chat, crm } = hero
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [inView, setInView] = useState(true)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduced) { setStep(FINAL); return }
    if (!inView) return
    const timers: number[] = []
    const run = () => {
      setStep(0)
      TIMELINE.forEach((ms, i) => timers.push(window.setTimeout(() => setStep(i + 1), ms)))
      timers.push(window.setTimeout(run, TIMELINE[FINAL - 1] + HOLD_MS))
    }
    run()
    return () => timers.forEach(clearTimeout)
  }, [inView, reduced])

  const on = (n: number) => (step >= n ? 'is-on' : '')
  // Arabic letters change shape when joined, so an Arabic name gets one initial.
  const initials = /[؀-ۿ]/.test(chat.contactName)
    ? chat.contactName[0]
    : chat.contactName.split(' ').map((w) => w[0]).slice(0, 2).join('')

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[520px] lg:me-0 lg:ms-auto" aria-hidden>
      {/* ── Chat ── */}
      <div className="nx-chat">
        <div className="flex items-center gap-3 border-b border-[var(--nx-line)] bg-[#0d1914] px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1f3b2e] text-[13px] font-semibold text-[#bff3d3]">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--nx-text)]">{chat.contactName}</p>
            <p className="flex items-center gap-1.5 text-xs text-[var(--nx-text-3)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--nx-signal)]" />
              {step === 2 ? chat.typing : chat.status}
            </p>
          </div>
          <span
            className={`nx-pop ${on(5)} inline-flex items-center gap-1.5 rounded-md bg-[rgba(37,211,102,0.12)] px-2 py-1 text-[11px] font-semibold text-[var(--nx-signal)]`}
          >
            <Sparkles className="h-3 w-3" />
            {chat.repliedIn}
          </span>
        </div>

        <div className="nx-chat-wall flex min-h-[288px] flex-col gap-2 px-4 pb-5 pt-4">
          <span className="mx-auto mb-1 rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--nx-text-3)]">
            {chat.today}
          </span>

          <div className={`nx-bubble nx-bubble-in nx-pop ${on(1)}`}>
            {chat.inbound1}
            <span className="ms-2 inline-block translate-y-0.5 text-[10px] text-[var(--nx-text-3)]">9:41</span>
          </div>

          {/* Typing indicator and the AI reply share one slot, so neither moves the layout. */}
          <div className="grid">
            <div className={`nx-bubble nx-bubble-in nx-pop col-start-1 row-start-1 self-end justify-self-start ${step === 2 ? 'is-on' : ''}`}>
              <span className="nx-typing flex h-5 items-center gap-1 px-1"><span /><span /><span /></span>
            </div>
            <div className={`nx-bubble nx-bubble-out nx-pop col-start-1 row-start-1 justify-self-end ${on(3)}`}>
              <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#8ef0b5]">
                <Sparkles className="h-3 w-3" /> {chat.aiLabel}
              </span>
              {chat.outbound1}
              <span className="ms-2 inline-flex translate-y-0.5 items-center gap-1 text-[10px] text-white/50">
                9:41 <Ticks step={step} />
              </span>
            </div>
          </div>

          <div className={`nx-bubble nx-bubble-in nx-pop ${on(6)}`}>
            {chat.inbound2}
            <span className="ms-2 inline-block translate-y-0.5 text-[10px] text-[var(--nx-text-3)]">9:42</span>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--nx-line)] bg-[#0d1914] px-3 py-2.5">
          <span className="flex-1 rounded-lg bg-white/[0.05] px-3 py-2 text-[13px] text-[var(--nx-text-3)]">{chat.composer}</span>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--nx-signal)] text-[var(--nx-signal-ink)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 rtl:-scale-x-100" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.99.99 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" /></svg>
          </span>
        </div>
      </div>

      {/* ── CRM record — overlaps the chat on wider screens, stacks below on phones ── */}
      <div
        className={`nx-record nx-pop ${on(1)} relative mt-3 w-full sm:absolute sm:-bottom-12 sm:end-[-1.5rem] sm:mt-0 sm:w-[252px] lg:end-[-2.5rem]`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nx-text-3)]">{crm.label}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--nx-signal)]" />
        </div>
        <Field label={crm.stage}>
          <span
            key={step >= 5 ? 'to' : 'from'}
            className={`nx-swap rounded-md px-2 py-0.5 text-xs font-semibold ${
              step >= 5 ? 'nx-flash text-[var(--nx-signal)]' : 'bg-white/[0.06] text-[var(--nx-text-2)]'
            }`}
          >
            {step >= 5 ? crm.stageTo : crm.stageFrom}
          </span>
        </Field>
        <Field label={crm.owner}>
          <span key={step >= 7 ? 'to' : 'from'} className={`nx-swap rounded-md px-1.5 py-0.5 font-medium ${step >= 7 ? 'nx-flash text-[var(--nx-text)]' : 'text-[var(--nx-text-2)]'}`}>
            {step >= 7 ? crm.ownerTo : crm.ownerFrom}
          </span>
        </Field>
        <Field label={crm.value}>
          <span className="nx-num font-semibold text-[var(--nx-text)]">{crm.valueAmount}</span>
        </Field>
        <div className="border-t border-[var(--nx-line)] px-4 py-2.5">
          <span className={`nx-pop ${on(5)} inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-line-strong)] px-2 py-1 text-[11px] font-medium text-[var(--nx-text-2)]`}>
            <Tag className="h-3 w-3" /> {crm.tag}
          </span>
        </div>
      </div>
    </div>
  )
}
