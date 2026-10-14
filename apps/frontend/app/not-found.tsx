import Link from 'next/link';
import { Home, MessageCircle } from 'lucide-react';

/**
 * Renders for any unknown route. Kept i18n-free so it works
 * even before the language provider mounts.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-canvas">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-surface">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-brand shadow-[0_4px_20px_rgba(37,211,102,0.25)]">
          <MessageCircle className="h-7 w-7 text-white" fill="white" strokeWidth={0} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-4">
          404
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="btn btn-primary mt-6 inline-flex justify-center"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
