// ─────────────────────────────────────────────────────────────────────────────
// What WhatsApp has cost — from Meta's pricing analytics for the WABA.
//
// This is WhatsApp only (no ads, no card, no business info), so it is safe to
// show to a manager who must not see the rest of Meta billing. Figures are
// Meta's approximation; the invoice remains the final amount.
// ─────────────────────────────────────────────────────────────────────────────

import { graphRequest } from './graph';

export interface UsageCategory { category: string; volume: number; cost: number }
export interface Usage {
  days: number;
  from: string;
  to: string;
  currency: string | null;
  totalCost: number;
  totalVolume: number;
  categories: UsageCategory[];
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; usage: Usage }>();

export async function getUsage(cloud: { accessToken: string; wabaId?: string | null }, days: number): Promise<Usage> {
  if (!cloud.wabaId) throw new Error('No WhatsApp Business account ID on this connection.');
  const key = `${cloud.wabaId}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.usage;

  // Whole UTC days, ending now; Meta wants unix seconds.
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const fields = `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`;
  const res = await graphRequest<any>({
    path: `/${cloud.wabaId}?fields=${encodeURIComponent(fields)}`,
    accessToken: cloud.accessToken,
    maxAttempts: 2,
  });

  const byCategory = new Map<string, UsageCategory>();
  for (const block of res.pricing_analytics?.data ?? []) {
    for (const p of block.data_points ?? []) {
      const category = String(p.pricing_category ?? 'UNKNOWN');
      const row = byCategory.get(category) ?? { category, volume: 0, cost: 0 };
      row.volume += Number(p.volume ?? 0);
      row.cost += Number(p.cost ?? 0);
      byCategory.set(category, row);
    }
  }
  const categories = [...byCategory.values()].sort((a, b) => b.cost - a.cost || b.volume - a.volume);

  const usage: Usage = {
    days,
    from: new Date(start * 1000).toISOString(),
    to: new Date(end * 1000).toISOString(),
    currency: res.currency ?? null,
    totalCost: categories.reduce((s, c) => s + c.cost, 0),
    totalVolume: categories.reduce((s, c) => s + c.volume, 0),
    categories,
  };
  cache.set(key, { at: Date.now(), usage });
  return usage;
}
