import { cn } from '@/lib/utils';

/**
 * Premium shimmering placeholder. Use to fill the *shape* of content while it
 * loads instead of a spinner — the app then feels instant. Styling lives in
 * globals.css (.skeleton).
 *
 * <Skeleton className="h-4 w-32 rounded-md" />
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn('skeleton', className)} style={style} />;
}

/** A few text lines of decreasing width — for message/detail bodies. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5 rounded', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** Conversation-list placeholder — mirrors an avatar + name + preview row. */
export function ConversationListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1 p-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-2/5 rounded" />
              <Skeleton className="h-2.5 w-10 rounded" />
            </div>
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
