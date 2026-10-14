'use client';

import { useState, useEffect } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Eye, EyeOff, Lock, Loader,
  Sun, Moon, Globe, ArrowRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useLanguage } from '@/components/providers/I18nProvider';
import AppUpdateBanner from '@/components/layout/AppUpdateBanner';

export default function LoginPage() {
  const { t, i18n } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const { theme, toggle: toggleTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        setError(t('login.error.invalidCredentials'));
      } else {
        const session = await getSession();
        if (session?.accessToken && typeof window !== 'undefined') {
          window.localStorage.setItem('accessToken', session.accessToken);
        }
        if (session?.refreshToken && typeof window !== 'undefined') {
          window.localStorage.setItem('refreshToken', session.refreshToken);
        }
        if (rememberMe && typeof window !== 'undefined') {
          window.localStorage.setItem('rememberMe', 'true');
        }
        router.push('/dashboard');
      }
    } catch {
      setError(t('login.error.generic'));
    } finally {
      setLoading(false);
    }
  };


  if (!mounted) {
    return (
      <div className="min-h-screen bg-white dark:bg-canvas" />
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-gray-50 dark:bg-canvas">
      <AppUpdateBanner />

      <div className="relative min-h-screen flex flex-col lg:flex-row">
        {/* Left side - Premium preview (desktop only) */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
          {/* Decorative elements */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-20 left-12 h-64 w-64 rounded-3xl bg-gradient-to-br from-brand/10 to-emerald-400/5 blur-2xl" />
            <div className="absolute bottom-32 right-12 h-72 w-72 rounded-full bg-gradient-to-tl from-blue-400/10 to-cyan-400/5 blur-3xl" />
          </div>

          {/* Top logo */}
          <div className="flex items-center gap-3 text-2xl font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo-tight.png" alt="Nexus CRM" className="h-12 w-12 rounded-2xl shadow-lg" />
            <span className="text-ink">CRM</span>
          </div>

          {/* Center content */}
          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-bold text-ink leading-tight">
                Professional Messaging at Scale
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Manage customer conversations, qualify leads, and automate workflows with AI-powered insights.
              </p>
            </div>

            {/* Feature cards */}
            <div className="space-y-3">
              {[
                { icon: '🚀', title: 'Real-time Sync', desc: 'Instant message delivery' },
                { icon: '🤖', title: 'AI-Powered', desc: 'Smart lead qualification' },
                { icon: '📊', title: 'Analytics', desc: 'Track your performance' },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="group flex items-start gap-4 p-4 rounded-xl bg-white/50 dark:bg-white/5 backdrop-blur-sm border border-gray-200/50 dark:border-white/10 hover:bg-white/70 dark:hover:bg-white/10 transition-all duration-300"
                >
                  <span className="text-2xl flex-shrink-0">{feature.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink">{feature.title}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{feature.desc}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-brand transition-colors flex-shrink-0 mt-0.5" />
                </div>
              ))}
            </div>
          </div>

          {/* Bottom security notice */}
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Lock className="h-4 w-4 text-brand" />
            <span>{t('login.security')}</span>
          </div>
        </div>

        {/* Right side - Login card */}
        <div className="flex w-full lg:w-1/2 flex-col items-center justify-center px-4 sm:px-6 lg:px-12 py-8 lg:py-0">
          {/* Top controls (mobile visible, desktop hidden) */}
          <div className="mb-8 flex w-full max-w-sm items-center justify-between lg:hidden">
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-raised text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-white/20 transition-all duration-200"
              aria-label="Toggle language"
            >
              <Globe className="h-4 w-4" />
              <span>{language === 'en' ? 'العربية' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-raised text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20 transition-all duration-200"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Main login card */}
          <div className="w-full max-w-sm">
            {/* Card header */}
            <div className="mb-8 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/logo-tight.png" alt="Nexus CRM" className="mx-auto mb-6 h-16 w-16 rounded-2xl shadow-lg shadow-brand/30" />
              <h2 className="text-3xl font-bold text-ink mb-2">
                {t('login.title')}
              </h2>
              <p className="text-base text-gray-600 dark:text-gray-400">
                {t('login.subtitle')}
              </p>
            </div>

            {/* Login card container */}
            <div className="rounded-xl border border-gray-200/60 dark:border-white/10 bg-white/80 dark:bg-surface/80 backdrop-blur-xl shadow-lg dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-8 space-y-6">
              {/* Error alert */}
              {error && (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-red-200/50 dark:border-red-500/30 bg-red-50/80 dark:bg-red-500/10 backdrop-blur px-4 py-3">
                  <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <form className="space-y-5" onSubmit={handleSubmit}>
                {/* Email field */}
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                    {t('login.emailLabel')}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={loading}
                    className="field w-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder={t('login.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {/* Password field */}
                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                    {t('login.passwordLabel')}
                  </label>
                  <div className="relative group">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      disabled={loading}
                      className="field w-full transition-all pr-12 disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={t('login.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {/* Remember me */}
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    className="h-4 w-4 rounded border border-line-strong bg-white dark:bg-white/5 text-brand transition-all checked:border-brand focus:border-brand focus:ring-[3px] focus:ring-brand/15 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                    {t('login.rememberMe')}
                  </span>
                </label>

                {/* Sign in button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-3 text-sm font-semibold text-white rounded-xl bg-gradient-to-r from-brand to-emerald-600 hover:from-brand/90 hover:to-emerald-600/90 shadow-lg shadow-brand/30 hover:shadow-brand/40 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                  {loading ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" />
                      <span>{t('login.signingIn')}</span>
                    </>
                  ) : (
                    <>
                      <span>{t('login.submitButton')}</span>
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              {/* Security notice - desktop visible */}
              <div className="hidden sm:flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-sm">
                <Lock className="h-4 w-4 text-brand flex-shrink-0" />
                <span className="text-emerald-800 dark:text-emerald-300">{t('login.security')}</span>
              </div>
            </div>

            {/* Bottom controls (desktop) */}
            <div className="mt-8 hidden lg:flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-4">
                <a href="#" className="hover:text-ink transition-colors">
                  {t('login.privacy')}
                </a>
                <a href="#" className="hover:text-ink transition-colors">
                  {t('login.terms')}
                </a>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-raised transition-colors"
                  aria-label="Toggle language"
                >
                  <Globe className="h-4 w-4" />
                  <span>{language === 'en' ? 'العربية' : 'EN'}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-raised transition-colors"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
