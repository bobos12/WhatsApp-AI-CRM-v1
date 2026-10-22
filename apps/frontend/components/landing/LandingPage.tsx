'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import {
  Reply, Filter, FileText, Activity, Sparkles, Languages,
  MessagesSquare, Workflow, Target, Megaphone, BarChart3,
  ArrowRight, Check, Plus, Menu, X, Globe, ShieldCheck, type LucideProps,
} from 'lucide-react'
import { useLanguage } from '@/components/providers/I18nProvider'
import CountUp from '@/components/reactbits/CountUp'
import { LANDING, type LandingContent, type LandingLang } from './content'
import Reveal from './Reveal'
import { InstallButton } from './InstallButton'
import HeroConversation from './HeroConversation'
import { nxArabic, nxLatin } from './fonts'

type Icon = ComponentType<LucideProps>

// ─── WhatsApp contact — every CTA opens a chat with the owner instead of
// a self-serve sign-up, since only the owner provisions new accounts.
const WHATSAPP_NUMBER = '201115655645'
function waLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}

const AI_ICONS: Record<string, Icon> = {
  replies: Reply, qualify: Filter, summary: FileText,
  sentiment: Activity, suggest: Sparkles, translate: Languages,
}
const TOUR_ICONS: Record<string, Icon> = {
  inbox: MessagesSquare, automation: Workflow, deals: Target,
  broadcasts: Megaphone, analytics: BarChart3,
}

/**
 * Screenshots of the product, rendered by `marketing/tools/render.mjs` on a
 * transparent background (the device frame's shadow is baked in).
 */
const SHOT: Record<string, { src: string; w: number; h: number }> = {
  dashboard:   { src: '/marketing/landing-dashboard.png',   w: 1980, h: 1351 },
  inbox:       { src: '/marketing/landing-inbox.png',       w: 1980, h: 1351 },
  automation:  { src: '/marketing/landing-automation.png',  w: 1980, h: 1351 },
  analytics:   { src: '/marketing/landing-analytics.png',   w: 1980, h: 1351 },
  deals:       { src: '/marketing/landing-deals.png',       w: 1980, h: 1351 },
  broadcasts:  { src: '/marketing/landing-broadcasts.png',  w: 1980, h: 1351 },
  phoneChat:   { src: '/marketing/landing-phone-chat.png',      w: 660,  h: 1265 },
  phoneInbox:  { src: '/marketing/landing-phone-inbox.png',     w: 660,  h: 1265 },
  phoneDash:   { src: '/marketing/landing-phone-dashboard.png', w: 660,  h: 1265 },
  aiThread:    { src: '/marketing/landing-detail-ai-thread.png',    w: 620,  h: 941 },
  contextRail: { src: '/marketing/landing-detail-context-rail.png', w: 400,  h: 885 },
}

const TOUR_MS = 7000

/** Messages pre-filled into the WhatsApp chat each CTA opens. */
function ctaMessage(isAr: boolean, kind: 'start' | 'question') {
  if (kind === 'question') return isAr ? 'مرحبًا، لدي سؤال عن NexusCRM' : 'Hi, I have a question about NexusCRM'
  return isAr ? 'مرحبًا، أرغب في البدء مع NexusCRM' : "Hi, I'd like to get started with NexusCRM"
}

// ─── Small pieces ──────────────────────────────────────────────────────────────
function WhatsAppGlyph({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 004.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.25 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
    </svg>
  )
}

function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-2.5" dir="ltr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo-tight.png" alt="" className={size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'} />
      <span className={`font-semibold tracking-[-0.03em] text-[var(--nx-text)] ${size === 'sm' ? 'text-base' : 'text-[1.1875rem]'}`}>
        Nexus<span className="ms-1 font-medium text-[var(--nx-text-3)]">CRM</span>
      </span>
    </span>
  )
}

function LangToggle({ className = '' }: { className?: string }) {
  const { language, setLanguage } = useLanguage()
  const next: LandingLang = language === 'ar' ? 'en' : 'ar'
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      title={next === 'ar' ? 'التبديل إلى العربية' : 'Switch to English'}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-[var(--nx-text-2)] transition-colors hover:bg-white/[0.05] hover:text-[var(--nx-text)] ${className}`}
    >
      <Globe className="h-4 w-4" />
      <span className={next === 'ar' ? 'font-[family-name:var(--nx-font-arabic)]' : ''}>{next === 'ar' ? 'العربية' : 'English'}</span>
    </button>
  )
}

function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="nx-eyebrow">
      <b>{n}</b>
      <i aria-hidden />
      {children}
    </p>
  )
}

function Shot({
  shot, alt, className = '', sizes, priority = false,
}: {
  shot: { src: string; w: number; h: number }
  alt: string
  className?: string
  sizes: string
  priority?: boolean
}) {
  return (
    <div className={className}>
      <Image
        src={shot.src}
        alt={alt}
        width={shot.w}
        height={shot.h}
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        draggable={false}
        className="h-auto w-full select-none"
      />
    </div>
  )
}

/** Watches which section is on screen so the nav can mark where you are. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join(',')
  useEffect(() => {
    const els = key.split(',').map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [key])
  return active
}

// ─── Nav ───────────────────────────────────────────────────────────────────────
function LandingNav({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const active = useActiveSection(t.nav.links.map((l) => l.id))

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled || open
          ? 'border-b border-[var(--nx-line)] bg-[rgba(6,16,12,0.86)] backdrop-blur-xl'
          : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="NexusCRM"><Wordmark /></Link>

        <div className="hidden items-center gap-1 lg:flex">
          {t.nav.links.map((l) => {
            const on = active === l.id
            return (
              <a
                key={l.id}
                href={`#${l.id}`}
                aria-current={on ? 'true' : undefined}
                className={`relative rounded-md px-3 py-2 text-sm transition-colors ${on ? 'text-[var(--nx-text)]' : 'text-[var(--nx-text-2)] hover:text-[var(--nx-text)]'}`}
              >
                {l.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-[var(--nx-signal)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${on ? 'scale-x-100' : 'scale-x-0'}`}
                />
              </a>
            )
          })}
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <LangToggle />
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--nx-text-2)] transition-colors hover:text-[var(--nx-text)]">
            {t.nav.signIn}
          </Link>
          <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" className="nx-btn nx-btn-primary nx-btn-sm ms-1">
            {t.nav.getStarted}
          </a>
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <LangToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t.nav.menu}
            aria-expanded={open}
            className="grid h-10 w-10 place-items-center rounded-lg text-[var(--nx-text)] transition-colors hover:bg-white/[0.05]"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <div className={`nx-collapse lg:hidden ${open ? 'is-open' : ''}`}>
        <div>
          <div className="mx-auto max-w-7xl px-4 pb-5 sm:px-6">
            {t.nav.links.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={() => setOpen(false)}
                className="flex h-12 items-center border-b border-[var(--nx-line)] text-[15px] font-medium text-[var(--nx-text)]"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/login" className="nx-btn nx-btn-ghost h-12">{t.nav.signIn}</Link>
              <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" className="nx-btn nx-btn-primary h-12">
                {t.nav.getStarted}
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

// ─── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties
  return (
    <section className="nx-hero-bg relative overflow-hidden">
      <div aria-hidden className="nx-glow" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-x-10 gap-y-16 px-4 pb-24 pt-28 sm:px-6 sm:pb-28 sm:pt-36 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:pb-32 lg:pt-40">
        <div>
          <p className="nx-eyebrow nx-rise" style={d(0)}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--nx-signal)] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--nx-signal)]" />
            </span>
            {t.hero.eyebrow}
          </p>

          <h1 className={`nx-display mt-7 ${isAr ? 'text-[clamp(2.3rem,4.6vw,4rem)]' : 'text-[clamp(2.5rem,4.5vw,4.1rem)]'}`}>
            <span className="nx-rise block" style={d(90)}>{t.hero.titleLine1}</span>
            <span className="nx-rise block text-[var(--nx-text-3)]" style={d(180)}>{t.hero.titleLine2}</span>
          </h1>

          <p className="nx-rise mt-7 max-w-[34rem] text-pretty text-[1.0625rem] leading-relaxed text-[var(--nx-text-2)] sm:text-lg" style={d(280)}>
            {t.hero.subtitle}
          </p>

          <div className="nx-rise mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap" style={d(370)}>
            <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" className="nx-btn nx-btn-primary">
              <WhatsAppGlyph />
              {t.hero.ctaPrimary}
            </a>
            <InstallButton variant="hero" label={t.hero.download} installedLabel={t.appInstalled} />
            <a href="#product" className="nx-btn nx-btn-ghost">
              {t.hero.ctaSecondary}
              <ArrowRight className="nx-arrow h-4 w-4" />
            </a>
          </div>

          <p className="nx-rise mt-6 text-sm text-[var(--nx-text-3)]" style={d(450)}>{t.hero.reassurance}</p>
        </div>

        <div className="nx-rise sm:pb-12" style={d(240)}>
          <HeroConversation hero={t.hero} />
        </div>
      </div>
    </section>
  )
}

// ─── Proof: the dashboard, the numbers, who it's for ───────────────────────────
function Proof({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  return (
    <section className="relative">
      <div className="mx-auto max-w-[1240px] px-2 sm:px-6 lg:px-8">
        <Reveal>
          <Shot shot={SHOT.dashboard} alt={isAr ? 'لوحة تحكم NexusCRM' : 'NexusCRM dashboard'} sizes="(max-width: 1280px) 100vw, 1240px" />
        </Reveal>
      </div>

      <div className="mx-auto mt-10 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--nx-line)] bg-[var(--nx-line)] lg:grid-cols-4">
            {t.stats.map((s, i) => (
              <div key={s.label} className="bg-[var(--nx-ink)] px-5 py-7 sm:px-7">
                <dt className="sr-only">{s.label}</dt>
                <dd className="nx-num text-[2.25rem] font-semibold leading-none tracking-[-0.04em] text-[var(--nx-text)] sm:text-5xl" dir="ltr">
                  <CountUp to={s.value} suffix={s.suffix} duration={2.2} delay={0.12 * i} />
                </dd>
                <dd className="mt-3 text-sm text-[var(--nx-text-3)]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        <Reveal>
          <p className="mx-auto mt-10 max-w-4xl text-center text-[15px] leading-8 text-[var(--nx-text-3)]">
            <span className="text-[var(--nx-text-2)]">{t.industries.title}</span>
            <span className="mx-3 text-[var(--nx-line-strong)]">—</span>
            {t.industries.items.map((it, i) => (
              <span key={it.key} className="whitespace-nowrap">
                {i > 0 && <span className="mx-2 text-[rgba(37,211,102,0.6)]">·</span>}
                {it.label}
              </span>
            ))}
          </p>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Product tour ──────────────────────────────────────────────────────────────
function Tour({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  const items = t.tour.items
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const [inView, setInView] = useState(false)
  const item = items[active]

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setAuto(false)
    const el = document.getElementById('product')
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const pick = (i: number) => { setActive(i); setAuto(false) }

  return (
    <section id="product" className="scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-[76rem]">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <Reveal>
            <Eyebrow n="01">{t.tour.eyebrow}</Eyebrow>
            <h2 className="nx-h2 mt-5">
              {t.tour.title} <span className="text-[var(--nx-text-3)]">{t.tour.titleMuted}</span>
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="text-[var(--nx-text-2)] lg:text-end">{t.tour.subtitle}</p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
          <Reveal>
            <div role="tablist" aria-orientation="vertical" aria-label={t.tour.eyebrow} className="border-t border-[var(--nx-line)]">
              {items.map((it, i) => {
                const on = i === active
                const Ic = TOUR_ICONS[it.key]
                return (
                  <div key={it.key} className="relative border-b border-[var(--nx-line)]">
                    <button
                      type="button"
                      role="tab"
                      id={`tour-tab-${it.key}`}
                      aria-selected={on}
                      aria-controls={`tour-panel-${it.key}`}
                      onClick={() => pick(i)}
                      className="group flex w-full items-center gap-4 py-5 text-start"
                    >
                      <span className={`nx-num w-6 text-xs font-semibold transition-colors ${on ? 'text-[var(--nx-signal)]' : 'text-[var(--nx-text-3)]'}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <Ic className={`h-[18px] w-[18px] transition-colors ${on ? 'text-[var(--nx-text)]' : 'text-[var(--nx-text-3)] group-hover:text-[var(--nx-text-2)]'}`} />
                      <span className={`text-lg font-semibold tracking-[-0.02em] transition-colors ${on ? 'text-[var(--nx-text)]' : 'text-[var(--nx-text-3)] group-hover:text-[var(--nx-text-2)]'}`}>
                        {it.label}
                      </span>
                      <Plus className={`ms-auto h-4 w-4 text-[var(--nx-text-3)] transition-transform duration-300 ${on ? 'rotate-45' : ''}`} />
                    </button>
                    {on && auto && (
                      <span className={`nx-progress ${inView ? '' : 'is-paused'}`} style={{ '--dur': `${TOUR_MS}ms` } as CSSProperties}>
                        <i onAnimationEnd={() => setActive((a) => (a + 1) % items.length)} />
                      </span>
                    )}
                    <div
                      id={`tour-panel-${it.key}`}
                      role="tabpanel"
                      aria-labelledby={`tour-tab-${it.key}`}
                      className={`nx-collapse ${on ? 'is-open' : ''}`}
                    >
                      <div>
                        <div className="pb-7 ps-10">
                          <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--nx-text)]">{it.title}</h3>
                          <p className="mt-2 leading-relaxed text-[var(--nx-text-2)]">{it.desc}</p>
                          <ul className="mt-5 space-y-2.5">
                            {it.bullets.map((b) => (
                              <li key={b} className="flex items-start gap-3 text-sm text-[var(--nx-text-2)]">
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-signal)]" />
                                {b}
                              </li>
                            ))}
                          </ul>
                          <div className="-ms-10 mt-6 lg:hidden">
                            <Shot shot={SHOT[it.key]} alt={`${it.label} — ${it.title}`} sizes="100vw" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Reveal>

          <Reveal delay={120} className="hidden lg:block">
            <div className="nx-frame sticky top-24">
              <div className="nx-plate bg-gradient-to-b from-[var(--nx-ink-3)] to-[var(--nx-ink-2)]" />
              <div className="relative px-2 py-6">
                <div key={item.key} className="nx-fade">
                  <Shot shot={SHOT[item.key]} alt={`${item.label} — ${item.title}`} sizes="680px" />
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-12 flex justify-start">
          <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" className="nx-link text-[var(--nx-signal)]">
            {t.nav.getStarted}
            <ArrowRight className="nx-arrow h-4 w-4" />
          </a>
        </Reveal>
      </div>
    </section>
  )
}

// ─── AI ────────────────────────────────────────────────────────────────────────
function AiSection({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  return (
    <section id="ai" className="scroll-mt-16 border-t border-[var(--nx-line)] px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-[76rem]">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <Eyebrow n="02">{t.ai.eyebrow}</Eyebrow>
              <h2 className="nx-h2 mt-5">
                {t.ai.title} <span className="text-[var(--nx-text-3)]">{t.ai.titleMuted}</span>
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-[var(--nx-text-2)]">{t.ai.subtitle}</p>
            </Reveal>

            <dl className="mt-10 grid gap-x-8 sm:grid-cols-2">
              {t.ai.capabilities.map((c, i) => {
                const Ic = AI_ICONS[c.key]
                return (
                  <Reveal key={c.key} delay={(i % 2) * 70}>
                    <div className="flex gap-3.5 border-t border-[var(--nx-line)] py-4">
                      <Ic className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--nx-signal)]" />
                      <div>
                        <dt className="text-[15px] font-semibold text-[var(--nx-text)]">{c.title}</dt>
                        <dd className="mt-1 text-sm leading-relaxed text-[var(--nx-text-3)]">{c.desc}</dd>
                      </div>
                    </div>
                  </Reveal>
                )
              })}
            </dl>

            <Reveal>
              <div className="mt-8 flex items-end gap-10">
                <div>
                  <p className="nx-num text-4xl font-semibold tracking-[-0.04em] text-[var(--nx-text)]" dir="ltr">
                    <CountUp to={8} suffix="s" duration={2} />
                  </p>
                  <p className="mt-2 text-sm text-[var(--nx-text-3)]">{t.ai.firstReply}</p>
                </div>
                <div className="h-12 w-px bg-[var(--nx-line-strong)]" />
                <div>
                  <p className="nx-num text-4xl font-semibold tracking-[-0.04em] text-[var(--nx-text)]" dir="ltr">
                    <CountUp to={68} suffix="%" duration={2} delay={0.2} />
                  </p>
                  <p className="mt-2 text-sm text-[var(--nx-text-3)]">{t.ai.resolved}</p>
                </div>
              </div>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <div className="nx-frame">
              <div className="nx-plate bg-gradient-to-b from-[var(--nx-ink-3)] to-[var(--nx-ink-2)]" />
              <div className="relative flex items-start justify-center gap-3 p-6 sm:p-10">
                <Shot
                  shot={SHOT.aiThread}
                  alt={isAr ? 'محادثة يديرها المساعد الذكي' : 'A conversation handled by the AI assistant'}
                  sizes="(max-width: 1024px) 70vw, 340px"
                  className="w-[64%] rounded-xl border border-[var(--nx-line)] shadow-2xl shadow-black/60"
                />
                <Shot
                  shot={SHOT.contextRail}
                  alt={isAr ? 'ملخص العميل والصفقة' : 'Customer summary, deal and timeline'}
                  sizes="(max-width: 1024px) 34vw, 180px"
                  className="mt-10 hidden w-[34%] rounded-xl border border-[var(--nx-line)] shadow-2xl shadow-black/60 sm:block"
                />
              </div>
            </div>
          </Reveal>
        </div>

        {/* From first message to closed deal — a track that draws itself */}
        <div className="mt-24 sm:mt-32">
          <Reveal>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <h3 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--nx-text)]">{t.workflow.title}</h3>
              <p className="text-sm text-[var(--nx-text-3)]">{t.workflow.subtitle}</p>
            </div>
          </Reveal>
          <Reveal>
            <ol className="relative mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
              <span aria-hidden className="nx-draw absolute inset-x-0 top-[7px] hidden h-px bg-gradient-to-r from-[var(--nx-signal)] via-[var(--nx-line-strong)] to-[var(--nx-line)] lg:block rtl:bg-gradient-to-l" />
              {t.workflow.steps.map((s, i) => (
                <li key={s.key} className="relative">
                  <span className="relative z-10 grid h-[15px] w-[15px] place-items-center rounded-full border border-[var(--nx-signal)] bg-[var(--nx-ink)]">
                    <span className="h-[5px] w-[5px] rounded-full bg-[var(--nx-signal)]" />
                  </span>
                  <p className="nx-num mt-5 text-xs font-semibold text-[var(--nx-signal)]">{String(i + 1).padStart(2, '0')}</p>
                  <p className="mt-1.5 font-semibold text-[var(--nx-text)]">{s.title}</p>
                  <p className="mt-1 max-w-[16rem] text-sm leading-relaxed text-[var(--nx-text-3)]">{s.desc}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ─── Mobile ────────────────────────────────────────────────────────────────────
function MobileSection({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  return (
    <section className="relative overflow-hidden border-t border-[var(--nx-line)] px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto grid max-w-[76rem] items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="lg:order-2">
          <Reveal>
            <Eyebrow n="03">{t.mobile.eyebrow}</Eyebrow>
            <h2 className="nx-h2 mt-5">
              {t.mobile.title} <span className="text-[var(--nx-text-3)]">{t.mobile.titleMuted}</span>
            </h2>
            <p className="mt-5 max-w-lg leading-relaxed text-[var(--nx-text-2)]">{t.mobile.subtitle}</p>
          </Reveal>
          <ul className="mt-8 max-w-lg">
            {t.mobile.bullets.map((b, i) => (
              <Reveal key={b} as="li" delay={i * 70} className="flex items-start gap-3 border-t border-[var(--nx-line)] py-3.5 text-[15px] text-[var(--nx-text-2)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-signal)]" />
                {b}
              </Reveal>
            ))}
          </ul>
          <Reveal delay={200}>
            <div className="mt-8">
              <InstallButton variant="hero" label={t.mobile.install} installedLabel={t.appInstalled} />
            </div>
          </Reveal>
        </div>

        <Reveal className="lg:order-1">
          <div className="relative mx-auto flex max-w-[560px] items-end justify-center">
            <Shot shot={SHOT.phoneDash} alt={isAr ? 'لوحة التحكم على الجوال' : 'Dashboard on mobile'} sizes="(max-width: 640px) 32vw, 180px" className="relative z-10 w-[32%] -rotate-6 translate-y-6" />
            <Shot shot={SHOT.phoneInbox} alt={isAr ? 'صندوق الوارد على الجوال' : 'Inbox on mobile'} sizes="(max-width: 640px) 38vw, 220px" className="relative z-20 -mx-4 w-[38%]" />
            <Shot shot={SHOT.phoneChat} alt={isAr ? 'محادثة على الجوال' : 'A chat on mobile'} sizes="(max-width: 640px) 32vw, 180px" className="relative z-10 w-[32%] rotate-6 translate-y-6" />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Customers (sand) ──────────────────────────────────────────────────────────
function Person({ author, role }: { author: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--nx-sand-text)] text-sm font-semibold text-[var(--nx-sand)]">
        {author.charAt(0)}
      </span>
      <div>
        <p className="text-sm font-semibold nx-c1">{author}</p>
        <p className="text-sm nx-c2">{role}</p>
      </div>
    </div>
  )
}

function Customers({ t }: { t: LandingContent }) {
  const [lead, ...rest] = t.testimonials.items
  return (
    <section id="customers" className="nx-sand scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-[76rem]">
        <Reveal>
          <Eyebrow n="04">{t.testimonials.eyebrow}</Eyebrow>
          <h2 className="nx-h2 mt-5 max-w-2xl">{t.testimonials.title}</h2>
        </Reveal>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--nx-sand-line)] bg-[var(--nx-sand-line)] lg:grid-cols-[1.4fr_1fr]">
          <Reveal className="flex flex-col justify-between gap-10 bg-[var(--nx-sand-2)] p-8 sm:p-12">
            <blockquote className="text-[1.5rem] font-medium leading-[1.4] tracking-[-0.02em] nx-c1 sm:text-[1.875rem]">
              <span className="me-1 text-[var(--nx-signal-deep)]">“</span>{lead.quote}<span className="text-[var(--nx-signal-deep)]">”</span>
            </blockquote>
            <Person author={lead.author} role={lead.role} />
          </Reveal>
          <div className="grid gap-px bg-[var(--nx-sand-line)]">
            {rest.map((tm, i) => (
              <Reveal key={tm.author} delay={(i + 1) * 90} className="flex flex-col justify-between gap-6 bg-[var(--nx-sand-2)] p-8">
                <blockquote className="leading-relaxed nx-c1">“{tm.quote}”</blockquote>
                <Person author={tm.author} role={tm.role} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── FAQ (sand) ────────────────────────────────────────────────────────────────
function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[var(--nx-sand-line)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-6 py-5 text-start">
        <span className="text-base font-semibold nx-c1 sm:text-[17px]">{q}</span>
        <Plus className={`h-5 w-5 shrink-0 nx-c2 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? 'rotate-45' : ''}`} />
      </button>
      <div className={`nx-collapse ${open ? 'is-open' : ''}`}>
        <div>
          <p className="max-w-2xl pb-6 leading-relaxed nx-c2">{a}</p>
        </div>
      </div>
    </div>
  )
}

function Faq({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="nx-sand scroll-mt-16 border-t border-[var(--nx-sand-line)] px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto grid max-w-[76rem] gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <Reveal>
          <Eyebrow n="05">{t.faq.eyebrow}</Eyebrow>
          <h2 className="nx-h2 mt-5">{t.faq.title}</h2>
          <p className="mt-5 nx-c2">{t.faq.subtitle}</p>
          <a href={waLink(ctaMessage(isAr, 'question'))} target="_blank" rel="noopener noreferrer" className="nx-link mt-8 text-[var(--nx-signal-deep)]">
            <WhatsAppGlyph className="h-4 w-4" />
            {t.faq.askUs}
          </a>
        </Reveal>
        <Reveal delay={100}>
          <div className="border-t border-[var(--nx-sand-line)]">
            {t.faq.items.map((item, i) => (
              <FaqItem key={item.q} q={item.q} a={item.a} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Final CTA (signal green) ──────────────────────────────────────────────────
function FinalCta({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  return (
    <section className="relative overflow-hidden bg-[var(--nx-signal)] px-4 py-24 text-[var(--nx-signal-ink)] sm:px-6 sm:py-28 lg:px-8">
      <span aria-hidden className="nx-mark pointer-events-none absolute -top-24 end-[-10rem] h-[38rem] w-[38rem] text-[var(--nx-signal-ink)] opacity-[0.07] sm:end-[-6rem]" />
      <div className="relative mx-auto grid max-w-[76rem] gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <Reveal>
          <h2 className={`nx-display ${isAr ? 'text-[clamp(2rem,4vw,3.4rem)]' : 'text-[clamp(2.3rem,4.8vw,4.1rem)]'}`}>{t.finalCta.title}</h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="max-w-md text-[17px] leading-relaxed text-[rgba(4,19,11,0.75)]">{t.finalCta.subtitle}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" className="nx-btn nx-btn-ink">
              <WhatsAppGlyph />
              {t.finalCta.primary}
            </a>
            <InstallButton variant="onSignal" label={t.mobile.install} installedLabel={t.appInstalled} />
          </div>
          <p className="mt-5 text-sm text-[rgba(4,19,11,0.62)]">{t.finalCta.reassurance}</p>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Footer ────────────────────────────────────────────────────────────────────
function Footer({ t }: { t: LandingContent }) {
  return (
    <footer className="px-4 pb-10 pt-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[76rem]">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2">
            <Wordmark size="sm" />
            <p className="mt-4 max-w-[260px] text-sm leading-relaxed text-[var(--nx-text-3)]">{t.footer.tagline}</p>
            <LangToggle className="-ms-2.5 mt-4" />
          </div>
          {t.footer.columns.map((col) => (
            <div key={col.title}>
              <p className="mb-4 text-sm font-semibold text-[var(--nx-text)]">{col.title}</p>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-sm text-[var(--nx-text-3)] transition-colors hover:text-[var(--nx-text)]">{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-[var(--nx-line)] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--nx-text-3)]">
            © {new Date().getFullYear()} NexusCRM. {t.footer.rights} {t.footer.disclaimer}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {t.footer.badges.map((b) => (
              <span key={b} className="inline-flex items-center gap-1.5 text-xs text-[var(--nx-text-3)]">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--nx-signal)]" /> {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

/** Phones: once the hero's CTA scrolls away, keep one tap to WhatsApp at the bottom. */
function MobileDock({ t, isAr }: { t: LandingContent; isAr: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      const fromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
      setShow(window.scrollY > 720 && fromBottom > 900)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className={`nx-dock fixed inset-x-0 bottom-0 z-40 border-t border-[var(--nx-line)] bg-[rgba(6,16,12,0.9)] px-4 pt-3 backdrop-blur-xl lg:hidden ${show ? 'is-on' : ''}`}>
      <a href={waLink(ctaMessage(isAr, 'start'))} target="_blank" rel="noopener noreferrer" tabIndex={show ? 0 : -1} className="nx-btn nx-btn-primary h-12 w-full">
        <WhatsAppGlyph />
        {t.hero.ctaPrimary}
      </a>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const { language } = useLanguage()
  const t = LANDING[language]
  const isAr = language === 'ar'

  return (
    <div className={`nx-root ${nxLatin.variable} ${nxArabic.variable} relative min-h-screen overflow-x-clip`}>
      <LandingNav t={t} isAr={isAr} />
      <main>
        <Hero t={t} isAr={isAr} />
        <Proof t={t} isAr={isAr} />
        <Tour t={t} isAr={isAr} />
        <AiSection t={t} isAr={isAr} />
        <MobileSection t={t} isAr={isAr} />
        <Customers t={t} />
        <Faq t={t} isAr={isAr} />
        <FinalCta t={t} isAr={isAr} />
      </main>
      <Footer t={t} />
      <MobileDock t={t} isAr={isAr} />
    </div>
  )
}
