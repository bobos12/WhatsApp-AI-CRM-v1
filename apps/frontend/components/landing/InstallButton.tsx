'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { Download, RefreshCw, Share, MoreVertical, ArrowDown } from 'lucide-react'
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

type Guide = 'ios' | 'android' | 'chromium' | 'safari-mac' | 'unsupported'

function desktopGuide(): Guide {
  const ua = navigator.userAgent
  if (/Edg\/|Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'chromium'
  if (/Safari\//.test(ua) && !/Chrome|Firefox/.test(ua)) return 'safari-mac'
  return 'unsupported'
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
  hint?: string
  installedLabel?: string
}

export function InstallButton({ variant = 'hero', className = '', label, hint, installedLabel }: InstallButtonProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [guide, setGuide] = useState<Guide | null>(null)
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

    // Captured early by bootstrap.js; shared by every Install button on the page.
    const syncPrompt = () => setInstallPrompt((window as any).__installPrompt ?? null)
    syncPrompt()

    // React when the SW registration announces a newer version (or one is
    // already waiting from a previous visit) so the button flips to "Update".
    if ((window as any).__swUpdateAvailable) setUpdateAvailable(true)
    const onUpdate = () => setUpdateAvailable(true)

    const onInstalled = () => setIsInstalled(true)
    window.addEventListener('install-prompt-ready', syncPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('sw-update-available', onUpdate)

    return () => {
      window.removeEventListener('install-prompt-ready', syncPrompt)
      window.removeEventListener('appinstalled', onInstalled)
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
      ;(window as any).__installPrompt = null
      setInstallPrompt(null)
      return
    }

    // No native prompt (browser without it, or the app is already installed):
    // show the short manual path. Never just reload the page.
    setGuide(platform === 'android' ? 'android' : desktopGuide())
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

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`nx-btn nx-btn-app ${variant === 'onSignal' ? 'nx-btn-app-ink' : ''} ${className}`}
      >
        <span className="nx-btn-app__icon">
          <Download className="h-5 w-5" />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="text-base font-bold">{label ?? 'Download the app'}</span>
          <span className="text-xs font-medium opacity-60">{hint ?? 'iPhone · Android · Desktop'}</span>
        </span>
      </button>

      {guide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setGuide(null)}
        >
          <div
            className={`w-full max-w-sm bg-[#0a1712] border border-white/10 rounded-2xl p-5 mx-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${guide === 'ios' ? 'mb-24' : 'mb-4 sm:mb-auto sm:mt-[20vh]'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-white text-base mb-4">
              {guide === 'ios' || guide === 'android' ? 'Add Nexus to your Home Screen' : 'Install Nexus on this computer'}
            </p>
            <ol className="space-y-3 text-sm text-white/70">
              <li className="flex items-center gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  {guide === 'ios' ? <Share className="w-4 h-4 text-[#25D366]" /> : <MoreVertical className="w-4 h-4 text-[#25D366]" />}
                </span>
                {GUIDE_STEPS[guide][0]}
              </li>
              <li className="flex items-center gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Download className="w-4 h-4 text-[#25D366]" />
                </span>
                {GUIDE_STEPS[guide][1]}
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

const b = (t: string) => <strong className="text-white">{t}</strong>

const GUIDE_STEPS: Record<Guide, [ReactNode, ReactNode]> = {
  ios: [
    <span key="1">Tap {b('Share')} below <span className="text-white/40">(inside ⋯ on newer iPhones)</span></span>,
    <span key="2">Tap {b('Add to Home Screen')}</span>,
  ],
  android: [
    <span key="1">Tap the browser menu {b('⋮')}</span>,
    <span key="2">Tap {b('Install app')} <span className="text-white/40">(or Add to Home screen)</span></span>,
  ],
  chromium: [
    <span key="1">Click the install icon at the right end of the {b('address bar')}</span>,
    <span key="2">Click {b('Install')} <span className="text-white/40">(already installed? it says Open in app)</span></span>,
  ],
  'safari-mac': [
    <span key="1">Open Safari&apos;s {b('File')} menu</span>,
    <span key="2">Choose {b('Add to Dock')}</span>,
  ],
  unsupported: [
    <span key="1">This browser can&apos;t install apps. Open this page in {b('Chrome')} or {b('Edge')}</span>,
    <span key="2">Click {b('Download the app')} again</span>,
  ],
}
