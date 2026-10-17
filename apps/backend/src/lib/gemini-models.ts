// ─────────────────────────────────────────────────────────────────────────────
// Gemini model discovery. Instead of hardcoding model ids (which Google retires
// every few months → 404s), we ask the API which models this key can use and
// pick the newest STABLE one per family. New releases are adopted automatically.
//
//   flash       → newest  gemini-X-flash        (best quality, small free quota)
//   flash-lite  → newest  gemini-X-flash-lite   (good quality, ~500/day free)
//   gemma       → newest  gemma-N-*-it, largest sizes first (huge free quota)
//
// Preview/experimental/tts/image/live variants are ignored on purpose: they have
// tighter limits and can disappear without notice.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from './logger';

export interface GeminiFamilies { flash: string[]; flashLite: string[]; gemma: string[] }

// Used until the first discovery succeeds (or if the list call fails).
const FALLBACK: GeminiFamilies = {
  flash: ['gemini-3.8-flash'],
  flashLite: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  gemma: ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'],
};

const REFRESH_MS = 12 * 60 * 60 * 1000;
let cache: { key: string; at: number; families: GeminiFamilies } | null = null;
let inflight: Promise<void> | null = null;

const num = (v: string) => parseFloat(v);

export function pickFamilies(ids: string[]): GeminiFamilies {
  const byVersion = (re: RegExp) =>
    ids
      .map((id) => ({ id, m: id.match(re) }))
      .filter((x): x is { id: string; m: RegExpMatchArray } => Boolean(x.m))
      .sort((a, b) => num(b.m[1]) - num(a.m[1]))
      .map((x) => x.id);

  const gemmaAll = ids
    .map((id) => ({ id, m: id.match(/^gemma-(\d+(?:\.\d+)?)-(\d+)b(?:-a\d+b)?-it$/) }))
    .filter((x): x is { id: string; m: RegExpMatchArray } => Boolean(x.m));
  const topGemma = Math.max(-1, ...gemmaAll.map((x) => num(x.m[1])));
  const gemma = gemmaAll
    .filter((x) => num(x.m[1]) === topGemma)
    .sort((a, b) => num(b.m[2]) - num(a.m[2]))
    .map((x) => x.id);

  return {
    flash: byVersion(/^gemini-(\d+(?:\.\d+)?)-flash$/).slice(0, 1),
    flashLite: byVersion(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/).slice(0, 2),
    gemma: gemma.slice(0, 2),
  };
}

async function refresh(apiKey: string): Promise<void> {
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) throw new Error(`list models ${resp.status}`);
    const data = (await resp.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const ids = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    const found = pickFamilies(ids);
    const families: GeminiFamilies = {
      flash: found.flash.length ? found.flash : FALLBACK.flash,
      flashLite: found.flashLite.length ? found.flashLite : FALLBACK.flashLite,
      gemma: found.gemma.length ? found.gemma : FALLBACK.gemma,
    };
    cache = { key: apiKey, at: Date.now(), families };
    logger.info('gemini.models_discovered', { ...families });
  } catch (err) {
    logger.warn('gemini.models_discovery_failed', { error: err instanceof Error ? err.message : String(err) });
    // Retry in 10 min rather than hammering the list endpoint on every message.
    cache = { key: apiKey, at: Date.now() - REFRESH_MS + 10 * 60 * 1000, families: cache?.families ?? FALLBACK };
  }
}

/** Current families for this key. Never blocks after the first call; refreshes in the background. */
export async function getGeminiFamilies(apiKey: string): Promise<GeminiFamilies> {
  if (!apiKey) return FALLBACK;
  const stale = !cache || cache.key !== apiKey || Date.now() - cache.at > REFRESH_MS;
  if (stale && !inflight) inflight = refresh(apiKey).finally(() => { inflight = null; });
  if (!cache || cache.key !== apiKey) await inflight;
  return cache?.families ?? FALLBACK;
}

/** Last known families without triggering a fetch (for the status endpoint). */
export function peekGeminiFamilies(): GeminiFamilies {
  return cache?.families ?? FALLBACK;
}
