'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}

export function TablePagination({
  page,
  pageSize,
  total,
  pageSizes = [10, 25, 50],
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const { t } = useTranslation('common');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const visiblePages: (number | 'dots')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) visiblePages.push(i);
  } else {
    const nearStart = page <= 4;
    const nearEnd = page >= totalPages - 3;
    if (nearStart) {
      for (let i = 1; i <= 5; i++) visiblePages.push(i);
      visiblePages.push('dots', totalPages);
    } else if (nearEnd) {
      visiblePages.push(1, 'dots');
      for (let i = totalPages - 4; i <= totalPages; i++) visiblePages.push(i);
    } else {
      visiblePages.push(1, 'dots', page - 1, page, page + 1, 'dots', totalPages);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-white/8">
      <div className="flex items-center gap-3">
        <span className="text-xs text-ink-3">
          {total === 0
            ? t('table.noResults')
            : t('pagination.showing', { from, to, total })}
        </span>
        <select
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number(e.target.value));
            onPageChange(1);
          }}
          className="h-7 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 outline-none focus:border-brand/50 dark:border-white/10 dark:bg-raised dark:text-ink-3 dark:focus:border-brand/50"
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>{s} {t('pagination.rowsPerPage').split(' ')[0]}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-ink-3 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label={t('pagination.previous')}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {visiblePages.map((p, i) =>
          p === 'dots' ? (
            <span key={`d-${i}`} className="px-1 text-xs text-ink-4">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p as number)}
              className={cn(
                'flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-xs font-medium transition-colors',
                p === page
                  ? 'bg-brand text-brand-fg dark:bg-brand dark:text-brand-fg'
                  : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-ink-3 dark:hover:bg-white/10 dark:hover:text-white',
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-ink-3 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label={t('pagination.next')}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
