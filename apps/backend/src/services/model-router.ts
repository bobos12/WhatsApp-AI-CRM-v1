// ─────────────────────────────────────────────────────────────────────────────
// Multi-provider model router. Each CRM feature gets its OWN ordered chain of
// free buckets across Gemini + Groq, so features never compete for the same
// daily quota until that whole chain is exhausted. The router tries each
// candidate in order and falls back automatically when one is rate-limited.
//
// Gemini ids are discovered at runtime (see lib/gemini-models.ts), so new
// Google releases are picked up automatically and retired ones never 404.
//
// Free-tier allocation (each model has its own independent daily quota):
//   • Customer bot      → newest Flash → newest Flash-Lite → Gemma (largest)
//                         → Groq 70B → Groq 8B
//   • Lead qualification→ 2nd Flash-Lite → Gemma (2nd) → Groq 8B
//   • CRM assistant     → Groq 8B → Gemma (2nd)
// The bot gets the best models; the background features use separate buckets
// so they never eat the customer bot's quota.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../lib/logger';
import { chatbotSettingsService } from './chatbot-settings.service';
import { groqChatWithFallback } from '../lib/groq-fallback';
import { callGeminiSingle, isGeminiAvailable } from '../lib/gemini-provider';
import { getGeminiFamilies, peekGeminiFamilies, type GeminiFamilies } from '../lib/gemini-models';

export type RouterFeature = 'bot' | 'qualification' | 'assistant';

interface Candidate { provider: 'gemini' | 'groq'; model: string }

const GROQ_70B: Candidate = { provider: 'groq', model: 'llama-3.3-70b-versatile' };
const GROQ_8B: Candidate = { provider: 'groq', model: 'llama-3.1-8b-instant' };

function buildChains(f: GeminiFamilies): Record<RouterFeature, Candidate[]> {
  const g = (model: string | undefined): Candidate[] => (model ? [{ provider: 'gemini', model }] : []);
  return {
    bot: [...g(f.flash[0]), ...g(f.flashLite[0]), ...g(f.gemma[0]), GROQ_70B, GROQ_8B],
    qualification: [...g(f.flashLite[1] ?? f.flashLite[0]), ...g(f.gemma[1] ?? f.gemma[0]), GROQ_8B],
    assistant: [GROQ_8B, ...g(f.gemma[1] ?? f.gemma[0])],
  };
}

export interface RouteOpts {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  temperature: number;
  jsonMode?: boolean;
}

export interface RouteResult { content: string | null; provider: string; model: string }

export function routerChains(): Record<RouterFeature, Candidate[]> { return buildChains(peekGeminiFamilies()); }

/** Every Gemini model the router may use (for the usage meter). */
export function routerGeminiModels(): string[] {
  const chains = routerChains();
  return [...new Set(Object.values(chains).flat().filter((c) => c.provider === 'gemini').map((c) => c.model))];
}

/**
 * Route one chat completion for a feature across its free-bucket chain.
 * Tries each candidate in order, skipping ones without a key or in cooldown,
 * and falls back on error/rate-limit. Throws only if every candidate fails.
 */
export async function routeChat(feature: RouterFeature, opts: RouteOpts): Promise<RouteResult> {
  const s = chatbotSettingsService.get();
  const groqKey = s.apiKey || process.env.GROQ_API_KEY || '';
  const geminiKey = (s as { geminiApiKey?: string }).geminiApiKey || process.env.GEMINI_API_KEY || '';

  const chain = buildChains(geminiKey ? await getGeminiFamilies(geminiKey) : peekGeminiFamilies())[feature];

  let lastErr = '';
  for (const cand of chain) {
    if (cand.provider === 'gemini' && (!geminiKey || !isGeminiAvailable(cand.model))) continue;
    if (cand.provider === 'groq' && !groqKey) continue;
    try {
      if (cand.provider === 'gemini') {
        const content = await callGeminiSingle({
          apiKey: geminiKey, model: cand.model,
          systemPrompt: opts.systemPrompt, messages: opts.messages,
          maxTokens: opts.maxTokens, temperature: opts.temperature, jsonMode: opts.jsonMode,
        });
        if (content) {
          logger.info('router.used', { feature, provider: 'gemini', model: cand.model });
          return { content, provider: 'gemini', model: cand.model };
        }
      } else {
        const r = await groqChatWithFallback({
          apiKey: groqKey, model: cand.model,
          systemPrompt: opts.systemPrompt, messages: opts.messages,
          maxTokens: opts.maxTokens, temperature: opts.temperature, jsonMode: opts.jsonMode,
        });
        if (r.content) {
          logger.info('router.used', { feature, provider: 'groq', model: r.model });
          return { content: r.content, provider: 'groq', model: r.model };
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      logger.warn('router.candidate_failed', { feature, provider: cand.provider, model: cand.model, error: lastErr });
    }
  }
  throw new Error(lastErr || `router: no provider available for ${feature}`);
}
