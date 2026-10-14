'use client';

import { useTranslation } from 'react-i18next';
import { Package, Plus, Trash2, X } from 'lucide-react';
import { Field, TextInput, TextArea, Toggle, SettingRow, SectionLabel } from './primitives';
import type { AiProduct } from '@/app/(dashboard)/admin/ai-config/types';

// Stable id for a freshly-added product.
function newProductId(): string {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch { /* noop */ }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Bilingual product catalog editor used by the Customer Bot knowledge section. */
export function ProductsEditor({ items, onChange }: { items: AiProduct[]; onChange: (next: AiProduct[]) => void }) {
  const { t } = useTranslation('aiconfig');
  const add = () => onChange([
    ...items,
    { id: newProductId(), nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', price: '', available: true, options: [] },
  ]);
  return (
    <div className="space-y-3">
      {items.map((p, i) => (
        <ProductCard key={p.id} index={i} product={p}
          onChange={(patch) => onChange(items.map((x) => x.id === p.id ? { ...x, ...patch } : x))}
          onRemove={() => onChange(items.filter((x) => x.id !== p.id))} />
      ))}
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">
          {t('products.empty')}
        </p>
      )}
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg bg-brand/15 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/25">
        <Plus className="h-4 w-4" /> {t('products.addProduct')}
      </button>
    </div>
  );
}

function ProductCard({ index, product, onChange, onRemove }: {
  index: number; product: AiProduct; onChange: (patch: Partial<AiProduct>) => void; onRemove: () => void;
}) {
  const { t } = useTranslation('aiconfig');
  const title = product.nameEn?.trim() || product.nameAr?.trim() || t('products.productN', { n: index + 1 });
  const addOpt = () => onChange({ options: [...product.options, { nameEn: '', nameAr: '', price: '' }] });
  const updOpt = (i: number, patch: Partial<AiProduct['options'][number]>) =>
    onChange({ options: product.options.map((o, idx) => idx === i ? { ...o, ...patch } : o) });
  const remOpt = (i: number) => onChange({ options: product.options.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4 rounded-xl border border-line bg-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate text-sm font-semibold text-ink">{title}</span>
          {!product.available && <span className="rounded-md bg-red-100 dark:bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">{t('products.unavailable')}</span>}
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-gray-200 dark:hover:bg-white/5 hover:text-red-700 dark:hover:text-red-400" aria-label={t('products.removeProduct')}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('products.nameEn')}><TextInput dir="ltr" value={product.nameEn} placeholder={t('products.nameEnPlaceholder')} onChange={(v) => onChange({ nameEn: v })} /></Field>
        <Field label={t('products.nameAr')}><TextInput dir="rtl" value={product.nameAr} placeholder={t('products.nameArPlaceholder')} onChange={(v) => onChange({ nameAr: v })} /></Field>
        <Field label={t('products.descEn')}><TextArea value={product.descriptionEn} rows={2} placeholder={t('products.descEnPlaceholder')} onChange={(v) => onChange({ descriptionEn: v })} /></Field>
        <Field label={t('products.descAr')}><TextArea value={product.descriptionAr} rows={2} placeholder={t('products.descArPlaceholder')} onChange={(v) => onChange({ descriptionAr: v })} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <Field label={t('products.price')}><TextInput value={product.price} placeholder={t('products.pricePlaceholder')} onChange={(v) => onChange({ price: v })} /></Field>
        </div>
        <SettingRow label={t('products.available')}>
          <Toggle checked={product.available} onChange={() => onChange({ available: !product.available })} />
        </SettingRow>
      </div>
      <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between">
          <SectionLabel>{t('products.options')}</SectionLabel>
          <button type="button" onClick={addOpt} className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/25">
            <Plus className="h-3 w-3" /> {t('products.addOption')}
          </button>
        </div>
        {product.options.length === 0 && <p className="text-[11px] text-ink-3">{t('products.optionsEmpty')}</p>}
        {product.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input dir="ltr" value={o.nameEn} onChange={(e) => updOpt(i, { nameEn: e.target.value })} placeholder={t('products.optEn')} className="field min-w-0 flex-1" />
            <input dir="rtl" value={o.nameAr} onChange={(e) => updOpt(i, { nameAr: e.target.value })} placeholder={t('products.optAr')} className="field min-w-0 flex-1" />
            <input value={o.price} onChange={(e) => updOpt(i, { price: e.target.value })} placeholder={t('products.optPrice')} className="field w-24 shrink-0" />
            <button type="button" onClick={() => remOpt(i)} className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-gray-200 dark:hover:bg-white/5 hover:text-red-700 dark:hover:text-red-400" aria-label={t('products.removeOption')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
