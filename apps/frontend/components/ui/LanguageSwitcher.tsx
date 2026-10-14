'use client';

import { useLanguage } from '@/components/providers/I18nProvider';
import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';

interface LanguageSwitcherProps {
  variant?: 'icon' | 'full' | 'compact';
  className?: string;
}

const LANGUAGES = [
  { code: 'en' as const, label: 'English', nativeLabel: 'English', flag: '🇺🇸' },
  { code: 'ar' as const, label: 'العربية', nativeLabel: 'العربية', flag: '🇸🇦' },
];

export default function LanguageSwitcher({ variant = 'compact', className }: LanguageSwitcherProps) {
  const { language, setLanguage } = useLanguage();

  if (variant === 'full') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => setLanguage(lang.code)}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3 text-start transition-all duration-150',
              language === lang.code
                ? 'border-brand/50 bg-brand/10 text-brand'
                : 'border-gray-200 bg-white text-gray-700 hover:border-brand/30 hover:bg-brand/5',
              'dark:border-white/10 dark:bg-white/5 dark:text-white',
              language === lang.code && 'dark:border-brand/40 dark:bg-brand/15 dark:text-brand',
            )}
          >
            <span className="text-xl leading-none">{lang.flag}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold">{lang.nativeLabel}</div>
              {lang.code === 'ar' && (
                <div className="text-xs text-ink-3">Arabic — RTL</div>
              )}
              {lang.code === 'en' && (
                <div className="text-xs text-ink-3">English — LTR</div>
              )}
            </div>
            {language === lang.code && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] text-brand-fg font-bold">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'compact') {
    const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
    const next = LANGUAGES.find((l) => l.code !== language) ?? LANGUAGES[1];
    return (
      <button
        type="button"
        onClick={() => setLanguage(next.code)}
        title={`Switch to ${next.nativeLabel}`}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
          'border-gray-200 bg-white text-gray-600 hover:border-brand/30 hover:bg-brand/5 hover:text-brand',
          'dark:border-white/5 dark:bg-white/5 dark:text-ink-3 dark:hover:border-brand/30 dark:hover:bg-brand/10 dark:hover:text-brand',
          className,
        )}
      >
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">{current.label}</span>
      </button>
    );
  }

  // icon variant
  const next = LANGUAGES.find((l) => l.code !== language) ?? LANGUAGES[1];
  return (
    <button
      type="button"
      onClick={() => setLanguage(next.code)}
      title={`Switch to ${next.nativeLabel}`}
      aria-label={`Switch to ${next.nativeLabel}`}
      className={cn(
        'rounded-lg border p-2 transition-colors duration-150',
        'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-brand',
        'dark:border-white/5 dark:bg-transparent dark:text-ink-3 dark:hover:bg-white/8 dark:hover:text-brand',
        className,
      )}
    >
      <Globe className="h-4 w-4" />
    </button>
  );
}
