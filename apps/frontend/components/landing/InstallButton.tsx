'use client'

import { useState, useEffect } from 'react'
import { Download, Smartphone, Monitor, Apple, RefreshCw, Share, MoreVertical, ArrowDown } from 'lucide-react'
import { hardRefresh } from '@/lib/hard-refresh'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Platform = 'android' | 'ios' | 'desktop' | 'unknown'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  // iPadOS reports itself as a Mac — touch support gives it away.
  if (/macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}

// WhatsApp / Instagram / Facebook etc. open links in their own browser, which
// can't install apps — so the button first hops the user into the real one.
function isInAppBrowser(platform: Platform): boolean {
  const ua = navigator.userAgent
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Bytedance|Twitter|LinkedInApp|WhatsApp/i.test(ua)) return true
  if (platform === 'ios') return !/Safari\//.test(ua)
  if (platform === 'android') return /; wv\)/.test(ua)
  return false
}

function withInstallFlag(): URL {
  const url = new URL(window.location.href)
  url.searchParams.set('install', '1')
  return url
}

function openInSystemBrowser(platform: Platform) {
  const url = withInstallFlag()
  if (platform === 'ios') {
    window.location.href = `x-safari-${url.href}`
  } else {
    const fallback = encodeURIComponent(url.href)
    window.location.href = `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`
  }
}

interface InstallButtonProps {
  variant?: 'hero' | 'section' | 'onSignal'
  className?: string
  label?: string
  installedLabel?: string
}

export function InstallButton({ variant = 'hero', className = '', label, installedLabel }: InstallButtonProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [guide, setGuide] = useState<'ios' | 'android' | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const p = detectPlatform()
    setPlatform(p)

    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    if (standalone) setIsInstalled(true)

    // Arrived from an in-app browser hop: show the final step straight away.
    const params = new URLSearchParams(window.location.search)
    if (params.get('install') === '1') {
      params.delete('install')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
      if (!standalone && p === 'ios') setGuide('ios')
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }

    // React when the SW registration announces a newer version (or one is
    // already waiting from a previous visit) so the button flips to "Update".
    if ((window as any).__swUpdateAvailable) setUpdateAvailable(true)
    const onUpdate = () => setUpdateAvailable(true)

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => setIsInstalled(true))
    window.addEventListener('sw-update-available', onUpdate)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('sw-update-available', onUpdate)
    }
  }, [])

  // Full hard refresh: activates the waiting SW, clears Cache Storage, then
  // reloads — guarantees the newest deployed build, not a stale cached shell.
  function applyUpdate() {
    if (updating) return
    setUpdating(true)
    void hardRefresh()
  }

  function handleClick() {
    if ((platform === 'ios' || platform === 'android') && !installPrompt && isInAppBrowser(platform)) {
      openInSystemBrowser(platform)
      return
    }

    if (platform === 'ios') {
      setGuide('ios')
      return
    }

    if (installPrompt) {
      installPrompt.prompt()
      installPrompt.userChoice.then(({ outcome }) => {
        if (outcome === 'accepted') setIsInstalled(true)
      })
      setInstallPrompt(null)
      return
    }

    if (platform === 'android') {
      setGuide('android')
      return
    }

    // No install prompt (already installed elsewhere / unsupported browser):
    // deliver the latest version instead — hard refresh past every cache.
    applyUpdate()
  }

  const surface =
    variant === 'hero' ? 'nx-btn-ghost' : variant === 'onSignal' ? 'nx-btn-outline-ink' : 'nx-btn-primary'

  if (isInstalled) {
    if (updateAvailable) {
      return (
        <button
          type="button"
          onClick={applyUpdate}
          disabled={updating}
          className={`nx-btn disabled:cursor-wait ${surface} ${className}`}
        >
          <RefreshCw className={`h-4 w-4 ${updating ? 'animate-spin' : ''}`} />
          {updating ? 'Updating…' : 'Update Available — Tap to Update'}
        </button>
      )
    }
    return (
      <span className={`inline-flex h-[3.25rem] items-center gap-2 text-sm font-semibold ${variant === 'onSignal' ? 'text-[var(--nx-signal-ink)]' : 'text-[var(--nx-signal)]'} ${className}`}>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
        </svg>
        {installedLabel ?? 'App Installed'}
      </span>
    )
  }

  const PlatformIcon = platform === 'ios' ? Apple : platform === 'android' ? Smartphone : Monitor

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={updating}
        className={`group nx-btn disabled:cursor-wait ${surface} ${className}`}
      >
        {updating
          ? <RefreshCw className="h-4 w-4 animate-spin" />
          : <Download className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />}
        <span>
          {updating
            ? 'Getting latest version…'
            : label ??
              (platform === 'ios'
                ? 'Add to Home Screen'
                : platform === 'android'
                ? 'Install Android App'
                : installPrompt
                ? 'Install Desktop App'
                : 'Get Latest Version')}
        </span>
        <PlatformIcon className="h-4 w-4 opacity-50" />
      </button>

      {guide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setGuide(null)}
        >
          <div
            className="w-full max-w-sm bg-[#0a1712] border border-white/10 rounded-2xl p-5 mx-4 mb-24 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-white text-base mb-4">Add Nexus to your Home Screen</p>
            <ol className="space-y-3 text-sm text-white/70">
              <li className="flex items-center gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  {guide === 'ios' ? <Share className="w-4 h-4 text-[#25D366]" /> : <MoreVertical className="w-4 h-4 text-[#25D366]" />}
                </span>
                {guide === 'ios'
                  ? <span>Tap <strong className="text-white">Share</strong> below <span className="text-white/40">(inside ⋯ on newer iPhones)</span></span>
                  : <span>Tap the browser menu <strong className="text-white">⋮</strong></span>}
              </li>
              <li className="flex items-center gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Download className="w-4 h-4 text-[#25D366]" />
                </span>
                <span>Tap <strong className="text-white">{guide === 'ios' ? 'Add to Home Screen' : 'Install app'}</strong></span>
              </li>
            </ol>
          </div>
          {guide === 'ios' && (
            <ArrowDown className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 w-8 h-8 text-[#25D366] animate-bounce motion-reduce:animate-none" />
          )}
        </div>
      )}
    </>
  )
}
