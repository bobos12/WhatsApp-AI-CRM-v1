/** @type {import('tailwindcss').Config} */

// Semantic colours resolve to CSS variables (RGB triplets, defined per theme in
// globals.css) so one class — `bg-surface`, `text-ink-3` — is correct in both
// light and dark, and opacity modifiers (`bg-brand/10`) still work.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    // Class maps also live in lib/ (stage tones, role badges) and hooks/.
    './lib/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /**
       * Colour-opacity modifiers (`bg-white/8`) resolve against this scale. A value
       * that isn't in it emits **no CSS at all**, silently — and the UI leaned on
       * these subtle tints in ~140 places, every one of them dead.
       *
       * The worst offender was table rows: `hover:bg-gray-50 dark:hover:bg-white/3`.
       * With `/3` missing, the dark rule never existed, so the un-gated light rule
       * applied in dark mode too — hovering a row turned it near-white and swallowed
       * the white text and buttons sitting on it.
       *
       * Every value below is one the design already uses. Extending the scale once
       * beats rewriting `bg-white/[0.03]` at 140 call sites.
       */
      opacity: {
        3: '0.03',
        4: '0.04',
        6: '0.06',
        7: '0.07',
        8: '0.08',
        12: '0.12',
        18: '0.18',
        92: '0.92',
        98: '0.98',
      },
      fontFamily: {
        // Plex Sans and Plex Sans Arabic are one family drawn to shared metrics,
        // so a mixed Arabic/English line sits on one baseline at one weight.
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', '"IBM Plex Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      colors: {
        /* ── Nexus semantic tokens ─────────────────────────────────────── */
        canvas: v('canvas'),
        surface: v('surface'),
        raised: v('raised'),
        overlay: v('overlay'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        brand: {
          DEFAULT: v('brand'),
          strong: v('brand-strong'),
          fg: v('brand-fg'),
          soft: v('brand-soft'),
          // Static scale for charts and illustration, identical in both themes.
          50: '#EDFBF2', 100: '#D3F5E0', 200: '#A8EAC4', 300: '#6FD9A0', 400: '#36C57A',
          500: '#1DAE60', 600: '#128245', 700: '#0F6A39', 800: '#0E5430', 900: '#0B4428', 950: '#042514',
        },
        bubble: { out: v('bubble-out'), in: v('bubble-in') },
        chat: v('chat-bg'),
        nav: { DEFAULT: v('nav'), ink: v('nav-ink'), muted: v('nav-muted'), line: v('nav-line'), hover: v('nav-hover') },
        // Neutral ramp re-tuned onto the brand's green-grey axis. Every existing
        // `gray-*` in the app moves with it, so legacy screens already sit in
        // the same family as the redesigned ones.
        gray: {
          50: '#F6F7F6', 100: '#EFF1F0', 200: '#E3E7E5', 300: '#CDD3D0', 400: '#9AA39E',
          500: '#69736E', 600: '#525C57', 700: '#3D4641', 800: '#262D2A', 900: '#151A17', 950: '#0B0F0D',
        },

        /* Shadcn UI CSS-variable-based tokens */
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        success: { 50: '#EDFBF2', 500: '#1DAE60', 700: '#0F6A39' },
        warning: { 50: '#FEF8EC', 500: '#D98E04', 700: '#9A5B00' },
        error:   { 50: '#FDF1F1', 500: '#DC4444', 700: '#A92A2A' },
      },
      // Structure comes from hairlines, not shadows. Elevation is reserved for
      // things that genuinely float: popovers, dialogs, drawers, toasts.
      boxShadow: {
        soft:  '0 1px 2px rgb(16 24 20 / 0.06)',
        card:  '0 1px 2px rgb(16 24 20 / 0.05), 0 1px 1px rgb(16 24 20 / 0.03)',
        lift:  '0 2px 4px rgb(16 24 20 / 0.06), 0 8px 24px -8px rgb(16 24 20 / 0.14)',
        pop:   '0 0 0 1px rgb(var(--line) / 1), 0 12px 32px -8px rgb(10 16 12 / 0.22), 0 4px 8px -4px rgb(10 16 12 / 0.10)',
        brand: '0 1px 2px rgb(18 130 69 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.12)',
        'wa-sm': '0 1px 2px rgb(16 24 20 / 0.06)',
        'wa-md': '0 2px 4px rgb(16 24 20 / 0.06), 0 8px 24px -8px rgb(16 24 20 / 0.14)',
      },
      // Tighter than Tailwind's own `xl`+ steps: controls 8px, panels 12px,
      // dialogs 16px. Large radii read as consumer/marketing, not a work tool.
      borderRadius: {
        xl:   '0.75rem',
        '2xl':'1rem',
        '3xl':'1.25rem',
        '4xl':'1.5rem',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
        swift: 'cubic-bezier(0.65, 0, 0.35, 1)',
      },
      transitionDuration: {
        fast: '140ms',
        base: '220ms',
        slow: '400ms',
      },
      animation: {
        'fade-in':  'fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        'enter':    'enter 0.36s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pop':      'pop 0.18s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-slow':'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        enter: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      spacing: {
        'xs': '0.25rem',
        'sm': '0.5rem',
        'md': '0.75rem',
        'lg': '1rem',
        'xl': '1.5rem',
        '2xl': '2rem',
      },
    },
  },
  plugins: [],
}
