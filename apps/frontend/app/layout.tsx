import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { AuthProvider } from '@/components/providers/SessionProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { I18nProvider } from '@/components/providers/I18nProvider'
import SplashController from '@/components/pwa/SplashController'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Nexus CRM — WhatsApp Business Platform',
    template: '%s | Nexus CRM',
  },
  description:
    'Turn WhatsApp conversations into revenue. The AI-powered WhatsApp CRM for businesses across the Gulf — shared inbox, automation, broadcast campaigns, and analytics. Full Arabic & English support. حوّل محادثات واتساب إلى مبيعات حقيقية.',
  keywords: [
    'WhatsApp CRM', 'WhatsApp CRM Saudi Arabia', 'WhatsApp CRM UAE', 'WhatsApp CRM Gulf', 'نظام واتساب', 'CRM واتساب',
    'WhatsApp automation', 'business messaging', 'WhatsApp campaigns', 'AI WhatsApp assistant',
  ],
  authors: [{ name: 'Nexus CRM' }],
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'Nexus CRM — WhatsApp CRM for the Gulf',
    description: 'Turn WhatsApp conversations into revenue. AI-powered, bilingual (Arabic & English) WhatsApp CRM for businesses across the Gulf.',
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['ar_SA'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nexus CRM — WhatsApp Business Platform',
    description: 'Professional WhatsApp CRM for modern businesses',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Nexus CRM',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Nexus CRM',
    'application-name': 'Nexus CRM',
    'msapplication-TileColor': '#25D366',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#25D366' },
    { media: '(prefers-color-scheme: dark)', color: '#128C7E' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // Extend under the notch / home indicator so env(safe-area-*) padding engages.
  viewportFit: 'cover',
  // Android: the keyboard shrinks the page instead of covering the composer.
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head />
      <body className="antialiased" suppressHydrationWarning>
        {/* Runs before React hydrates — prevents theme/RTL/PWA flash */}
        <Script id="bootstrap" src="/scripts/bootstrap.js" strategy="beforeInteractive" />

        {/* Native launch screen — visible only in the installed (standalone) app,
            painted in the initial HTML so there's no white flash on cold start.
            SplashController holds it ≥1.6s (premium startup animation, not a
            delay) then dissolves it with a blur+scale exit. */}
        <div id="app-splash" aria-hidden="true">
          <div className="app-splash__center">
            <span className="app-splash__halo" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo-tight.png" alt="" className="app-splash__logo" />
          </div>
        </div>
        <SplashController />
        {/* PWA service worker registration + update detection */}
        <Script id="register-sw" strategy="afterInteractive">{`
          window.__applySWUpdate = function () {
            var w = window.__swWaitingWorker;
            var reloaded = false;
            var reload = function () { if (!reloaded) { reloaded = true; window.location.reload(); } };
            if (w && 'serviceWorker' in navigator) {
              // Wait for the new SW to actually take control before reloading,
              // otherwise the reload can still be served by the OLD worker.
              navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
              w.postMessage({ type: 'SKIP_WAITING' });
              setTimeout(reload, 1500); // safety: never leave the user hanging
            } else {
              reload();
            }
          };
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () {
              navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
                var announce = function (sw) {
                  window.__swUpdateAvailable = true;
                  window.__swWaitingWorker = sw;
                  window.dispatchEvent(new CustomEvent('sw-update-available'));
                };
                // A new version may already be parked in "waiting" from a
                // previous visit — surface it immediately.
                if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
                // Periodically check for updates every 30 minutes
                setInterval(function () { reg.update(); }, 30 * 60 * 1000);
                reg.addEventListener('updatefound', function () {
                  var newSW = reg.installing;
                  if (!newSW) return;
                  newSW.addEventListener('statechange', function () {
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                      announce(newSW);
                    }
                  });
                });
              }).catch(function (err) { console.warn('SW registration failed:', err); });
            });
          }
        `}</Script>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>{children}</AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
