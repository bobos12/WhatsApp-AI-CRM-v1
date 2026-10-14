/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@crm/messaging-schema'],
  // No `experimental.optimizePackageImports` here on purpose. It looks like an
  // obvious win — 92 files import from lucide-react's barrel — but measured on
  // this project it made Turbopack *slower* (cold route compile 4.9s → 6.4s),
  // because Turbopack already resolves barrel exports natively and the option
  // just adds a redundant rewrite pass. It is a webpack-era optimisation.
  async headers() {
    return [
      {
        // Service worker must not be cached, otherwise updates won't reach clients
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // PWA manifest
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
