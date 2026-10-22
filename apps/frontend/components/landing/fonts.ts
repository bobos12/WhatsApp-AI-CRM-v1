import { IBM_Plex_Sans_Arabic, Instrument_Sans } from 'next/font/google'

// Self-hosted by next/font and scoped to the landing page through CSS
// variables, so the app keeps its own system-font stack.
export const nxLatin = Instrument_Sans({
  subsets: ['latin'],
  variable: '--nx-font-latin',
  display: 'swap',
})

export const nxArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--nx-font-arabic',
  display: 'swap',
})
