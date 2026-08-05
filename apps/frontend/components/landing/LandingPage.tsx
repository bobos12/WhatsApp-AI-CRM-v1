'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, type ComponentType } from 'react'
import {
  Users, BotMessageSquare, Megaphone, Workflow, Contact,
  BarChart3, Sparkles, Reply, Filter, FileText, Activity, Languages,
  User, Bot, Database, UtensilsCrossed, Stethoscope, Building2, Store,
  ShoppingBag, GraduationCap, Car, Check, ArrowRight, ChevronDown,
  Star, ShieldCheck, Menu, X, Globe, Timer, Target,
  MessagesSquare, Smartphone, BellRing, type LucideProps,
} from 'lucide-react'
import { useLanguage } from '@/components/providers/I18nProvider'
import { LANDING, type LandingLang } from './content'
import Reveal from './Reveal'
import { InstallButton } from './InstallButton'
import CountUp from '@/components/reactbits/CountUp'
import SpotlightCard from '@/components/reactbits/SpotlightCard'

type Icon = ComponentType<LucideProps>

// ─── WhatsApp contact — every CTA opens a chat with the owner instead of
// a self-serve sign-up, since only the owner provisions new accounts.
const WHATSAPP_NUMBER = '201115655645'
function waLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}

const FEATURE_ICONS: Record<string, Icon> = {
  inbox: Users, ai: BotMessageSquare, broadcast: Megaphone,
  automation: Workflow, crm: Contact, analytics: BarChart3,
}
const AI_ICONS: Record<string, Icon> = {
  replies: Reply, qualify: Filter, summary: FileText,
  sentiment: Activity, suggest: Sparkles, translate: Languages,
}
const WORKFLOW_ICONS: Record<string, Icon> = {
  customer: User, ai: Bot, team: Users, crm: Database, reports: BarChart3,
}
const INDUSTRY_ICONS: Record<string, Icon> = {
  restaurants: UtensilsCrossed, clinics: Stethoscope, realestate: Building2,
  retail: Store, ecommerce: ShoppingBag, education: GraduationCap,
  automotive: Car, agencies: Megaphone,
}
const TOUR_ICONS: Record<string, Icon> = {
  inbox: MessagesSquare, automation: Workflow, deals: Target,
  broadcasts: Megaphone, analytics: BarChart3,
}

/**
 * Screenshots of the running product, rendered by `marketing/tools/render.mjs`
 * on a transparent background so the page's aurora shows through the device
 * frame's shadow instead of being punched out by a dark rectangle.
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

// ─── Logo / brand mark ─────────────────────────────────────────────────────────
function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const img = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const text = size === 'sm' ? 'text-base' : 'text-lg'
  return (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/app-logo.png" alt="NexusCRM" className={`${img} rounded-full object-cover drop-shadow-lg`} />
      <span className={`font-extrabold ${text} tracking-tight text-white`}>
        Nexus<span className="text-gold-gradient">CRM</span>
      </span>
    </div>
  )
}

// ─── Language toggle ───────────────────────────────────────────────────────────
function LangToggle({ className = '' }: { className?: string }) {
  const { language, setLanguage } = useLanguage()
  const next: LandingLang = language === 'ar' ? 'en' : 'ar'
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      title={next === 'ar' ? 'التبديل إلى العربية' : 'Switch to English'}
      className={`group inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:border-[#d4af37]/40 hover:text-[#f3d98b] ${className}`}
    >
      <Globe className="h-3.5 w-3.5" />
      <span>{language === 'ar' ? 'EN' : 'عربي'}</span>
    </button>
  )
}

// ─── Sticky navbar ─────────────────────────────────────────────────────────────
function LandingNav() {
  const { language } = useLanguage()
  const t = LANDING[language]
  const isAr = language === 'ar'
  const getStartedMsg = isAr
    ? 'مرحبًا، أرغب في البدء مع NexusCRM'
    : "Hi, I'd like to get started with NexusCRM"
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-white/10 bg-[#050b14]/80 backdrop-blur-xl supports-[backdrop-filter]:bg-[#050b14]/70'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="NexusCRM home"><BrandMark /></Link>

        <div className="hidden items-center gap-8 text-sm text-white/65 lg:flex">
          {t.nav.links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="relative transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <LangToggle />
          <Link href="/login" className="text-sm font-medium text-white/70 transition-colors hover:text-white">
            {t.nav.signIn}
          </Link>
          <a
            href={waLink(getStartedMsg)}
            target="_blank"
            rel="noopener noreferrer"
            className="lux-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-transform duration-200 hover:scale-[1.03] active:scale-95"
          >
            {t.nav.getStarted}
          </a>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 lg:hidden">
          <LangToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t.nav.menu}
            aria-expanded={open}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/10 bg-[#050b14]/95 backdrop-blur-xl lg:hidden">
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-4 sm:px-6">
            {t.nav.links.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-3">
              <Link href="/login" className="rounded-lg border border-white/12 px-4 py-2.5 text-center text-sm font-semibold text-white/80">
                {t.nav.signIn}
              </Link>
              <a
                href={waLink(getStartedMsg)}
                target="_blank"
                rel="noopener noreferrer"
                className="lux-btn-primary rounded-lg px-4 py-2.5 text-center text-sm font-bold text-white"
              >
                {t.nav.getStarted}
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Section heading ───────────────────────────────────────────────────────────
function SectionHeading({
  eyebrow, children, sub, headFont,
}: { eyebrow: string; children: React.ReactNode; sub?: string; headFont?: React.CSSProperties }) {
  return (
    <div className="mx-auto mb-14 max-w-2xl text-center">
      <Reveal>
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#f3d98b]">
          {eyebrow}
        </p>
      </Reveal>
      <Reveal delay={80}>
        <h2 style={headFont} className="text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
          {children}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={140}>
          <p className="mt-4 text-pretty leading-relaxed text-white/55">{sub}</p>
        </Reveal>
      )}
    </div>
  )
}

/**
 * A product screenshot with the ambient glow the rest of the page uses.
 * `priority` is only set on the hero shot — everything below the fold is lazy.
 */
function Shot({
  shot, alt, className = '', sizes, priority = false, glow = true,
}: {
  shot: { src: string; w: number; h: number }
  alt: string
  className?: string
  sizes: string
  priority?: boolean
  glow?: boolean
}) {
  return (
    <div className={`relative ${className}`}>
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[6%] inset-y-[10%] rounded-[3rem] bg-gradient-to-br from-[#25D366]/22 via-[#d4af37]/8 to-transparent blur-[70px]"
        />
      )}
      <Image
        src={shot.src}
        alt={alt}
        width={shot.w}
        height={shot.h}
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        draggable={false}
        className="relative h-auto w-full select-none"
      />
    </div>
  )
}

// ─── FAQ accordion item ────────────────────────────────────────────────────────
function FaqItem({ q, a, headFont }: { q: string; a: string; headFont?: React.CSSProperties }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="lux-card overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start sm:px-6 sm:py-5"
      >
        <span style={headFont} className="text-sm font-semibold text-white sm:text-base">{q}</span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-transform duration-300 ${open ? 'rotate-180 border-[#25D366]/40 text-[#25D366]' : ''}`}>
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm leading-relaxed text-white/55 sm:px-6">{a}</p>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const { language, isRTL } = useLanguage()
  const t = LANDING[language]
  const isAr = language === 'ar'
  const headFont: React.CSSProperties | undefined = isAr ? { fontFamily: "'Tajawal', sans-serif" } : undefined
  const arrowFlip = isRTL ? 'rotate-180' : ''

  const [tourTab, setTourTab] = useState(0)
  const tour = t.tour.items[tourTab]

  return (
    <div className="lux-root relative min-h-screen overflow-x-hidden bg-[#050b14] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="lux-aurora absolute inset-0 opacity-90" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[#25D366]/10 blur-[140px]" />
        <div className="absolute right-0 top-1/3 h-[420px] w-[420px] rounded-full bg-[#d4af37]/6 blur-[130px]" />
      </div>

      <LandingNav />

      <main className="relative z-10">
        {/* ─── HERO ─────────────────────────────────────────────── */}
        <section className="relative px-4 pt-28 sm:px-6 sm:pt-32 lg:px-8">
          <div className="lux-grid pointer-events-none absolute inset-0 -z-10" />

          <div className="mx-auto max-w-4xl text-center">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-3.5 py-1.5 text-xs font-semibold text-[#5cf0a0]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#25D366]" />
                {t.hero.badge}
              </span>
            </Reveal>

            <h1
              style={headFont}
              className="mt-6 text-balance text-4xl font-black leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl xl:text-[4.25rem]"
            >
              {t.hero.titlePre}
              <span className="text-gold-gradient">{t.hero.titleGold}</span>
              {t.hero.titlePost}
            </h1>

            <Reveal delay={120}>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-white/60 sm:text-lg">
                {t.hero.subtitle}
              </p>
            </Reveal>

            <Reveal delay={200}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={waLink(isAr ? 'مرحبًا، أرغب في بدء تجربتي المجانية مع NexusCRM' : "Hi, I'd like to start my free NexusCRM trial")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lux-btn-primary group inline-flex w-full items-center justify-center gap-2.5 rounded-xl px-7 py-3.5 text-base font-bold text-white transition-transform duration-200 hover:scale-[1.03] active:scale-95 sm:w-auto"
                >
                  {t.hero.ctaPrimary}
                  <ArrowRight className={`h-4 w-4 transition-transform group-hover:translate-x-1 ${arrowFlip}`} />
                </a>
                <InstallButton
                  variant="hero"
                  className="lux-pulse-ring w-full sm:w-auto"
                  label={isAr ? 'حمّل التطبيق' : 'Download the App'}
                  installedLabel={isAr ? 'التطبيق مثبّت' : 'App Installed'}
                />
              </div>
            </Reveal>

            <Reveal delay={280}>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm text-white/45">
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-[#f3d98b] text-[#f3d98b]" />
                    ))}
                  </span>
                  <span className="font-medium text-white/70">{t.hero.ratingLabel}</span>
                </span>
                <span className="hidden h-3 w-px bg-white/15 sm:block" />
                <span>{t.hero.noCard}</span>
              </div>
            </Reveal>
          </div>

          {/* The product itself — real dashboard, framed, floating over the aurora */}
          <Reveal delay={160}>
            <div className="relative mx-auto mt-16 max-w-[1180px]">
              <Shot
                shot={SHOT.dashboard}
                alt={isAr ? 'لوحة تحكم NexusCRM' : 'NexusCRM dashboard'}
                sizes="(max-width: 1280px) 100vw, 1180px"
                priority
              />

              {/*
                Floating proof — hidden on small screens where they'd crowd the shot.
                Offsets are percentages, not fixed pixels: the screenshot carries
                ~4.5% horizontal / ~6.7% vertical transparent padding around the
                browser frame, so a `-top-4` would float in empty space above it.
              */}
              <div className="lux-float-delay lux-glass absolute top-[3%] end-[1%] z-20 hidden rounded-2xl border border-white/12 p-3.5 shadow-xl shadow-black/40 md:block">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#25D366]/15">
                    <Bot className="h-5 w-5 text-[#25D366]" />
                  </div>
                  <div>
                    <p className="text-base font-extrabold leading-none text-white">
                      <CountUp to={68} suffix="%" duration={2.2} />
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/50">{t.hero.floating.aiHandled}</p>
                  </div>
                </div>
              </div>

              <div className="lux-float lux-glass absolute bottom-[26%] start-[-2%] z-20 hidden rounded-2xl border border-white/12 p-3.5 shadow-xl shadow-black/40 md:block">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#d4af37]/15">
                    <Timer className="h-5 w-5 text-[#f3d98b]" />
                  </div>
                  <div>
                    <p className="text-base font-extrabold leading-none text-white">8s</p>
                    <p className="mt-0.5 text-[11px] text-white/50">{t.hero.floating.replies}</p>
                  </div>
                </div>
              </div>

              {/* Fade the shot into the page instead of cutting it off hard */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -bottom-1 h-32 bg-gradient-to-t from-[#050b14] via-[#050b14]/70 to-transparent"
              />
            </div>
          </Reveal>

          {/* Trust marquee */}
          <div className="mx-auto mt-8 max-w-7xl">
            <p className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
              {t.trust.label}
            </p>
            <div className="lux-marquee relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
              <div className="lux-marquee-track gap-12 pe-12">
                {[...t.industries.items, ...t.industries.items].map((it, i) => {
                  const Ic = INDUSTRY_ICONS[it.key]
                  return (
                    <span key={i} className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-white/40">
                      <Ic className="h-4 w-4" /> {it.label}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ─── STATS BAND ───────────────────────────────────────── */}
        <section className="px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <div className="lux-card mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden rounded-3xl md:grid-cols-4">
              {t.stats.map((s, i) => (
                <div key={i} className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
                  <span className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                    <CountUp to={s.value} suffix={s.suffix} duration={2.4} delay={0.15 * i} />
                  </span>
                  <span className="text-xs text-white/45 sm:text-sm">{s.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ─── PRODUCT TOUR ─────────────────────────────────────── */}
        <section id="product" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.tour.eyebrow} sub={t.tour.subtitle} headFont={headFont}>
              {t.tour.title} <span className="text-emerald-gradient">{t.tour.titleGold}</span>
            </SectionHeading>

            {/* Tab rail */}
            <Reveal>
              <div
                role="tablist"
                aria-label={t.tour.eyebrow}
                className="mx-auto mb-10 flex max-w-3xl flex-wrap items-center justify-center gap-2"
              >
                {t.tour.items.map((item, i) => {
                  const Ic = TOUR_ICONS[item.key]
                  const active = i === tourTab
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTourTab(i)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                        active
                          ? 'border-[#25D366]/40 bg-[#25D366]/12 text-white shadow-[0_8px_24px_-10px_rgba(37,211,102,0.6)]'
                          : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white/85'
                      }`}
                    >
                      <Ic className={`h-4 w-4 ${active ? 'text-[#5cf0a0]' : ''}`} />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </Reveal>

            {/* Active screen. `key` remounts on tab change so the fade replays. */}
            <div key={tour.key} className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="lux-reveal is-visible order-2 lg:order-1">
                <h3 style={headFont} className="text-balance text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                  {tour.title}
                </h3>
                <p className="mt-4 leading-relaxed text-white/55">{tour.desc}</p>
                <ul className="mt-7 space-y-3">
                  {tour.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 text-sm text-white/75">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#25D366]/15">
                        <Check className="h-3.5 w-3.5 text-[#25D366]" />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
                <a
                  href={waLink(isAr ? 'مرحبًا، أرغب في البدء مع NexusCRM' : "Hi, I'd like to get started with NexusCRM")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-[#5cf0a0] transition-colors hover:text-[#f3d98b]"
                >
                  {t.nav.getStarted}
                  <ArrowRight className={`h-4 w-4 transition-transform group-hover:translate-x-1 ${arrowFlip}`} />
                </a>
              </div>

              <div className="order-1 lg:order-2">
                <Shot
                  shot={SHOT[tour.key]}
                  alt={`${tour.label} — ${tour.title}`}
                  sizes="(max-width: 1024px) 100vw, 680px"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── FEATURES ─────────────────────────────────────────── */}
        <section id="features" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.features.eyebrow} sub={t.features.subtitle} headFont={headFont}>
              {t.features.title} <span className="text-emerald-gradient">{t.features.titleMuted}</span>
            </SectionHeading>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {t.features.items.map((f, i) => {
                const Ic = FEATURE_ICONS[f.key]
                return (
                  <Reveal key={f.key} delay={(i % 3) * 80}>
                    <SpotlightCard
                      spotlightColor="rgba(37, 211, 102, 0.14)"
                      className="lux-card h-full rounded-2xl p-6"
                    >
                      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#25D366]/18 to-[#0f9b6c]/8 ring-1 ring-inset ring-[#25D366]/15">
                        <Ic className="h-6 w-6 text-[#5cf0a0]" />
                      </div>
                      <h3 style={headFont} className="mb-2 text-base font-bold text-white">{f.title}</h3>
                      <p className="text-sm leading-relaxed text-white/55">{f.desc}</p>
                    </SpotlightCard>
                  </Reveal>
                )
              })}
            </div>
          </div>
        </section>

        {/* ─── AI SECTION ───────────────────────────────────────── */}
        <section id="ai" className="relative scroll-mt-20 overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-[#25D366]/[0.04] to-transparent" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
            <div>
              <Reveal>
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#f3d98b]">
                  <Sparkles className="h-3.5 w-3.5" /> {t.ai.eyebrow}
                </p>
              </Reveal>
              <Reveal delay={80}>
                <h2 style={headFont} className="text-balance text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl">
                  {t.ai.title} <span className="text-gold-gradient">{t.ai.titleGold}</span>
                </h2>
              </Reveal>
              <Reveal delay={140}>
                <p className="mt-4 leading-relaxed text-white/55">{t.ai.subtitle}</p>
              </Reveal>

              <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {t.ai.capabilities.map((c, i) => {
                  const Ic = AI_ICONS[c.key]
                  return (
                    <Reveal key={c.key} delay={i * 60}>
                      <div className="lux-card flex items-start gap-3 rounded-xl p-3.5">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#25D366]/12">
                          <Ic className="h-5 w-5 text-[#5cf0a0]" />
                        </div>
                        <div>
                          <p style={headFont} className="text-sm font-semibold text-white">{c.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-white/50">{c.desc}</p>
                        </div>
                      </div>
                    </Reveal>
                  )
                })}
              </div>

              <Reveal delay={240}>
                <div className="mt-8 flex flex-wrap items-center gap-6">
                  <div>
                    <p className="text-3xl font-black tracking-tight text-white">
                      <CountUp to={8} suffix="s" duration={2} />
                    </p>
                    <p className="mt-1 text-xs text-white/45">{isAr ? 'متوسط أول رد من الذكاء الاصطناعي' : 'average AI first reply'}</p>
                  </div>
                  <div className="h-10 w-px bg-white/12" />
                  <div>
                    <p className="text-3xl font-black tracking-tight text-white">
                      <CountUp to={68} suffix="%" duration={2} delay={0.2} />
                    </p>
                    <p className="mt-1 text-xs text-white/45">{isAr ? 'محادثات لا تصل لموظف' : 'resolved without an agent'}</p>
                  </div>
                </div>
              </Reveal>
            </div>

            {/* Real conversation + the real context rail beside it */}
            <Reveal delay={120}>
              <div className="relative mx-auto flex max-w-[560px] items-start justify-center gap-3">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br from-[#d4af37]/14 via-[#25D366]/12 to-transparent blur-[60px]"
                />
                <Shot
                  shot={SHOT.aiThread}
                  glow={false}
                  alt={isAr ? 'محادثة يديرها المساعد الذكي' : 'A conversation handled by the AI assistant'}
                  sizes="(max-width: 1024px) 70vw, 360px"
                  className="w-[64%] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60"
                />
                <Shot
                  shot={SHOT.contextRail}
                  glow={false}
                  alt={isAr ? 'ملخص العميل والصفقة' : 'Customer summary, deal and timeline'}
                  sizes="(max-width: 1024px) 34vw, 190px"
                  className="mt-8 hidden w-[34%] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60 sm:block"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── WORKFLOW ─────────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.workflow.eyebrow} sub={t.workflow.subtitle} headFont={headFont}>
              {t.workflow.title}
            </SectionHeading>

            <div className="relative grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <div className="pointer-events-none absolute inset-x-12 top-9 hidden h-px bg-gradient-to-r from-[#25D366]/0 via-[#d4af37]/40 to-[#25D366]/0 lg:block" />
              {t.workflow.steps.map((s, i) => {
                const Ic = WORKFLOW_ICONS[s.key]
                return (
                  <Reveal key={s.key} delay={i * 90}>
                    <div className="relative flex flex-col items-center text-center">
                      <div className="relative mb-5">
                        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-[#0c1726] to-[#091321] shadow-lg shadow-black/40">
                          <Ic className="h-7 w-7 text-[#5cf0a0]" />
                        </div>
                        <span className="absolute -end-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#f3d98b] to-[#d4af37] text-[11px] font-black text-[#1a1407]">
                          {i + 1}
                        </span>
                      </div>
                      <h3 style={headFont} className="mb-1.5 text-base font-bold text-white">{s.title}</h3>
                      <p className="max-w-[15rem] text-sm leading-relaxed text-white/50">{s.desc}</p>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>
        </section>

        {/* ─── SHOWCASE — the real inbox ────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <Reveal>
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#f3d98b]">
                  {t.showcase.eyebrow}
                </p>
              </Reveal>
              <Reveal delay={80}>
                <h2 style={headFont} className="text-balance text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl">
                  {t.showcase.title} <span className="text-gold-gradient">{t.showcase.titleGold}</span>
                </h2>
              </Reveal>
              <Reveal delay={140}>
                <p className="mt-4 leading-relaxed text-white/55">{t.showcase.subtitle}</p>
              </Reveal>
              <ul className="mt-7 space-y-3">
                {t.showcase.bullets.map((b, i) => (
                  <li key={i}>
                    <Reveal delay={i * 70}>
                      <span className="flex items-start gap-3 text-sm text-white/75">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#25D366]/15">
                          <Check className="h-3.5 w-3.5 text-[#25D366]" />
                        </span>
                        {b}
                      </span>
                    </Reveal>
                  </li>
                ))}
              </ul>
            </div>

            <Reveal delay={120}>
              <Shot
                shot={SHOT.inbox}
                alt={isAr ? 'صندوق الوارد المشترك في NexusCRM' : 'The NexusCRM shared inbox'}
                sizes="(max-width: 1024px) 100vw, 720px"
              />
            </Reveal>
          </div>
        </section>

        {/* ─── MOBILE ───────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
            {/* Three phones, overlapped */}
            <Reveal>
              <div className="relative mx-auto flex max-w-[620px] items-end justify-center">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-[#25D366]/18 to-[#d4af37]/8 blur-[80px]"
                />
                <Shot
                  shot={SHOT.phoneDash}
                  glow={false}
                  alt={isAr ? 'لوحة التحكم على الجوال' : 'Dashboard on mobile'}
                  sizes="(max-width: 640px) 32vw, 190px"
                  className="relative z-10 w-[32%] -rotate-6 translate-y-6"
                />
                <Shot
                  shot={SHOT.phoneInbox}
                  glow={false}
                  alt={isAr ? 'صندوق الوارد على الجوال' : 'Inbox on mobile'}
                  sizes="(max-width: 640px) 38vw, 230px"
                  className="relative z-20 -mx-4 w-[38%]"
                />
                <Shot
                  shot={SHOT.phoneChat}
                  glow={false}
                  alt={isAr ? 'محادثة على الجوال' : 'A chat on mobile'}
                  sizes="(max-width: 640px) 32vw, 190px"
                  className="relative z-10 w-[32%] rotate-6 translate-y-6"
                />
              </div>
            </Reveal>

            <div>
              <Reveal>
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d4af37]/25 bg-[#d4af37]/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#f3d98b]">
                  <Smartphone className="h-3.5 w-3.5" /> {t.mobile.eyebrow}
                </p>
              </Reveal>
              <Reveal delay={80}>
                <h2 style={headFont} className="text-balance text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl">
                  {t.mobile.title} <span className="text-gold-gradient">{t.mobile.titleGold}</span>
                </h2>
              </Reveal>
              <Reveal delay={140}>
                <p className="mt-4 leading-relaxed text-white/55">{t.mobile.subtitle}</p>
              </Reveal>
              <ul className="mt-7 space-y-3">
                {t.mobile.bullets.map((b, i) => (
                  <li key={b}>
                    <Reveal delay={i * 70}>
                      <span className="flex items-start gap-3 text-sm text-white/75">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#25D366]/15">
                          <BellRing className="h-3 w-3 text-[#25D366]" />
                        </span>
                        {b}
                      </span>
                    </Reveal>
                  </li>
                ))}
              </ul>
              <Reveal delay={280}>
                <div className="mt-8">
                  <InstallButton
                    variant="hero"
                    label={isAr ? 'ثبّت التطبيق' : 'Install the App'}
                    installedLabel={isAr ? 'التطبيق مثبّت' : 'App Installed'}
                  />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ─── INDUSTRIES ───────────────────────────────────────── */}
        <section id="industries" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.industries.eyebrow} sub={t.industries.subtitle} headFont={headFont}>
              {t.industries.title}
            </SectionHeading>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {t.industries.items.map((it, i) => {
                const Ic = INDUSTRY_ICONS[it.key]
                return (
                  <Reveal key={it.key} delay={(i % 4) * 70}>
                    <div className="group lux-card flex h-full flex-col items-start gap-4 rounded-2xl p-5 hover:-translate-y-1">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#25D366]/12 ring-1 ring-inset ring-[#25D366]/15 transition-colors group-hover:bg-[#25D366]/20">
                        <Ic className="h-6 w-6 text-[#5cf0a0]" />
                      </div>
                      <p style={headFont} className="text-sm font-bold text-white sm:text-base">{it.label}</p>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>
        </section>

        {/* ─── TESTIMONIALS ─────────────────────────────────────── */}
        <section className="px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.testimonials.eyebrow} headFont={headFont}>
              {t.testimonials.title}
            </SectionHeading>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {t.testimonials.items.map((tm, i) => (
                <Reveal key={tm.author} delay={i * 90}>
                  <SpotlightCard
                    spotlightColor="rgba(212, 175, 55, 0.12)"
                    className="lux-card flex h-full flex-col gap-4 rounded-2xl p-6"
                  >
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, s) => (
                        <Star key={s} className="h-4 w-4 fill-[#f3d98b] text-[#f3d98b]" />
                      ))}
                    </div>
                    <p className="flex-1 text-sm leading-relaxed text-white/75">&ldquo;{tm.quote}&rdquo;</p>
                    <div className="flex items-center gap-3 border-t border-white/8 pt-4">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#25D366]/30 to-[#d4af37]/20 text-sm font-bold text-white">
                        {tm.author.charAt(0)}
                      </div>
                      <div>
                        <p style={headFont} className="text-sm font-semibold text-white">{tm.author}</p>
                        <p className="text-xs text-white/45">{tm.role}</p>
                      </div>
                    </div>
                  </SpotlightCard>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── PRICING ──────────────────────────────────────────── */}
        <section id="pricing" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={t.pricing.eyebrow} sub={t.pricing.subtitle} headFont={headFont}>
              {t.pricing.title}
            </SectionHeading>

            <div className="mx-auto grid max-w-6xl grid-cols-1 items-stretch gap-6 md:grid-cols-3">
              {t.pricing.plans.map((p, i) => (
                <Reveal key={p.key} delay={i * 90}>
                  <div
                    className={`relative flex h-full flex-col rounded-2xl p-7 transition-transform duration-300 ${
                      p.highlight
                        ? 'lux-card-gold scale-[1.02] md:scale-105'
                        : 'lux-card hover:-translate-y-1'
                    }`}
                  >
                    {p.highlight && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#f3d98b] to-[#d4af37] px-3 py-1 text-[11px] font-black uppercase tracking-wide text-[#1a1407] shadow-lg">
                        {t.pricing.mostPopular}
                      </span>
                    )}

                    <p style={headFont} className="text-sm font-bold uppercase tracking-wider text-white/60">{p.name}</p>

                    <div className="mt-4 flex items-baseline gap-1.5">
                      <span className={`text-4xl font-black tracking-tight ${p.highlight ? 'text-gold-gradient' : 'text-white'}`}>
                        {p.price}
                      </span>
                      {/* Only a real number takes a "/month" suffix — "Free" and "Custom" do not. */}
                      {/\d/.test(p.price) && (
                        <span className="text-sm text-white/40">{t.pricing.perMonth}</span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-white/45">{p.sub}</p>

                    <ul className="mt-7 flex-1 space-y-3">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
                          <span
                            className={`mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full ${
                              p.highlight ? 'bg-[#d4af37]/20' : 'bg-[#25D366]/15'
                            }`}
                            style={{ height: '1.125rem', width: '1.125rem' }}
                          >
                            <Check className={`h-3 w-3 ${p.highlight ? 'text-[#f3d98b]' : 'text-[#25D366]'}`} />
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>

                    <a
                      href={waLink(isAr ? `مرحبًا، أنا مهتم بخطة ${p.name}` : `Hi, I'm interested in the ${p.name} plan`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-transform duration-200 hover:scale-[1.02] active:scale-95 ${
                        p.highlight
                          ? 'lux-btn-gold'
                          : 'border border-white/12 bg-white/5 text-white/85 hover:bg-white/10'
                      }`}
                    >
                      {p.cta}
                      <ArrowRight className={`h-4 w-4 ${arrowFlip}`} />
                    </a>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FAQ ──────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <SectionHeading eyebrow={t.faq.eyebrow} sub={t.faq.subtitle} headFont={headFont}>
              {t.faq.title}
            </SectionHeading>
            <div className="space-y-3">
              {t.faq.items.map((item, i) => (
                <Reveal key={i} delay={i * 60}>
                  <FaqItem q={item.q} a={item.a} headFont={headFont} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FINAL CTA ────────────────────────────────────────── */}
        <section className="px-4 pb-24 pt-8 sm:px-6 lg:px-8">
          <Reveal>
            <div className="lux-hairline relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0c1f1a] via-[#091321] to-[#0c1726] px-6 pt-16 text-center sm:px-12">
              <div className="lux-aurora pointer-events-none absolute inset-0 opacity-80" />
              <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-[#25D366]/15 blur-[110px]" />
              <div className="relative">
                <h2 style={headFont} className="mx-auto max-w-2xl text-balance text-3xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[2.6rem]">
                  {t.finalCta.title}
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-pretty leading-relaxed text-white/55">{t.finalCta.subtitle}</p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <a
                    href={waLink(isAr ? 'مرحبًا، أرغب في بدء تجربتي المجانية مع NexusCRM' : "Hi, I'd like to start my free NexusCRM trial")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lux-btn-primary group inline-flex w-full items-center justify-center gap-2.5 rounded-xl px-8 py-4 text-base font-bold text-white transition-transform duration-200 hover:scale-[1.03] active:scale-95 sm:w-auto"
                  >
                    {t.finalCta.primary}
                    <ArrowRight className={`h-5 w-5 transition-transform group-hover:translate-x-1 ${arrowFlip}`} />
                  </a>
                  <InstallButton
                    variant="hero"
                    className="w-full justify-center sm:w-auto"
                    label={isAr ? 'ثبّت التطبيق' : 'Install the App'}
                    installedLabel={isAr ? 'التطبيق مثبّت' : 'App Installed'}
                  />
                </div>
                <p className="mt-6 text-xs text-white/35">{t.finalCta.reassurance}</p>

                {/* The product, peeking in from the bottom — the last thing they see */}
                <div className="relative mx-auto mt-12 max-w-3xl">
                  <Shot
                    shot={SHOT.analytics}
                    glow={false}
                    alt={isAr ? 'تحليلات NexusCRM' : 'NexusCRM analytics'}
                    sizes="(max-width: 768px) 100vw, 768px"
                    className="translate-y-2"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0a1520] to-transparent"
                  />
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/8 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
            <div className="col-span-2">
              <BrandMark size="sm" />
              <p className="mt-3 max-w-[230px] text-sm leading-relaxed text-white/40">{t.footer.tagline}</p>
              <div className="mt-4">
                <LangToggle />
              </div>
            </div>
            {t.footer.columns.map((col) => (
              <div key={col.title}>
                <p style={headFont} className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/55">{col.title}</p>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-sm text-white/40 transition-colors hover:text-[#f3d98b]">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/8 pt-7 sm:flex-row">
            <p className="text-xs text-white/30">
              © {new Date().getFullYear()} NexusCRM. {t.footer.rights} {t.footer.disclaimer}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {t.footer.badges.map((b) => (
                <span key={b} className="inline-flex items-center gap-1.5 text-xs text-white/35">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#25D366]/60" /> {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
