import path from 'path';
import fs from 'fs';
import { logger } from '../lib/logger';
import { getTenantId } from '../lib/tenant-context';

// ─────────────────────────────────────────────────────────────────────────────
// Structured, fully-editable AI configuration for the customer-facing WhatsApp
// bot. This is the SINGLE SOURCE OF TRUTH for the customer bot: behavior
// (personality, company knowledge, rules → generated prompt), gating (WHEN the
// bot answers), and targeting (WHICH customers it answers). The final system
// prompt is GENERATED from this config (see ai-prompt-builder.ts) rather than
// authored as a single blob of text.
//
// Storage mirrors chatbot-settings.service.ts: a cached, file-based JSON store.
// Provider + API key live in chatbot-settings.service.ts (single source of
// credentials, shared with the CRM assistant + lead qualification); everything
// else about the customer bot lives here, with no overlapping fields.
// ─────────────────────────────────────────────────────────────────────────────

export type ResponseLength = 'short' | 'medium' | 'long';
export type ResponseSpeed = 'fast' | 'balanced' | 'thorough';
export type Tone = 'professional' | 'friendly' | 'luxury' | 'formal' | 'casual';
export type EmojiUsage = 'none' | 'low' | 'medium' | 'high';
export type ConfigLanguage = 'ar' | 'en' | 'auto';
/** Arabic dialect the bot uses when it replies in Arabic. */
export type ArabicDialect = 'saudi' | 'gulf' | 'egyptian' | 'levantine' | 'msa';
export type SalesMode = 'off' | 'soft' | 'hard' | 'consultation';

export interface AiGeneralSettings {
  model: string;
  temperature: number;       // 0–1
  maxTokens: number;
  responseLength: ResponseLength;
  creativityLevel: number;   // 0–1
  responseSpeed: ResponseSpeed;
}

export interface AiPersonality {
  assistantName: string;
  tone: Tone;
  formality: number;         // 0–1
  emojiUsage: EmojiUsage;
  humorLevel: number;        // 0–1
  language: ConfigLanguage;
  /** Arabic dialect used for Arabic replies (Saudi by default). */
  dialect: ArabicDialect;
  /** Free-text character/persona the bot must embody (e.g. "a calm, expert Saudi sales advisor named Sara"). */
  persona: string;
  writingStyle: string;      // free text
}

export interface AiCompanyKnowledge {
  name: string;
  about: string;
  services: string;
  pricing: string;
  faqs: string;
  policies: string;
  workingHours: string;
  locations: string;
  contact: string;
  notes: string;
}

// ── Products: WHAT the business sells (bilingual catalog) ────────────────────
export interface AiProductOption {
  nameEn: string;
  nameAr: string;
  price: string;   // free text, e.g. "+20 SAR" or "199"
}

export interface AiProduct {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: string;          // free text, e.g. "199 SAR" or "from 99"
  available: boolean;
  options: AiProductOption[];
}

export interface AiProductsConfig {
  /** Include the catalog in the generated prompt. */
  enabled: boolean;
  /** Default currency label (e.g. "SAR"), shown to the bot. Optional. */
  currency: string;
  items: AiProduct[];
}

export interface AiSalesConfig {
  mode: SalesMode;
  leadQualificationQuestions: string[];
  bookingFlow: string;
  cta: string;
  upsell: string;
  crossSell: string;
  closing: string;
}

export interface AiConversationRules {
  /** The greeting the bot opens a NEW conversation with. Blank = no scripted welcome. */
  welcomeMessage: string;
  /** true = send the welcome verbatim; false = let the bot adapt it to the customer/language. */
  welcomeMessageExact: boolean;
  maxResponseChars: number;  // 0 = no limit
  maxSentences: number;      // 0 = no limit
  useBulletPoints: boolean;
  alwaysGreet: boolean;
  alwaysEndWithCta: boolean;
  useCustomerName: boolean;
  askFollowUp: boolean;
  typingStyle: string;       // free text
}

export interface AiSafetyConfig {
  businessOnlyMode: boolean;
  refusePolitical: boolean;
  refuseReligious: boolean;
  refuseMedical: boolean;
  refuseLegal: boolean;
  humanEscalation: boolean;
  safeMode: boolean;
  forbiddenTopics: string[];
}

export interface AiHandoffTriggers {
  complaint: boolean;
  refund: boolean;
  manager: boolean;
  humanAgent: boolean;
  technicalSupport: boolean;
}

export interface AiHandoffConfig {
  enabled: boolean;
  triggers: AiHandoffTriggers;
  customTriggers: string[];
  transferMessage: string;
}

export interface AiMemoryConfig {
  contextLength: number;
  rememberName: boolean;
  rememberOrders: boolean;
  rememberPreferences: boolean;
  persistent: boolean;
}

export interface AiCustomVariable {
  key: string;
  value: string;
}

// ── Gating: WHEN the bot is allowed to answer ────────────────────────────────
export interface AiGatingConfig {
  businessHoursEnabled: boolean;
  businessHoursStart: string;     // "HH:MM" local server time
  businessHoursEnd: string;       // "HH:MM" local server time
  offHoursMessage: string;        // sent when a message arrives outside hours (blank = stay silent)
  maxResponsesPerHour: number;    // 0 = unlimited; rate-limit bot replies per conversation
  batchWindowSeconds: number;     // wait this long after the customer's last message before replying (groups a multi-message question into one answer)
  ignoreFirstMessage: boolean;    // skip the very first inbound message in a conversation
  typingDelayMs: number;          // ms to wait before sending (0-5000)
  fallbackMessage: string;        // sent when the AI returns null or errors (blank = stay silent)
  pauseDurationHours: number;     // how long a customer-driven handoff pause lasts
}

export type TargetingMode = 'all' | 'rules';
export type TargetingAudience = 'all' | 'new_only' | 'returning_only';

// ── Targeting: WHICH customers the bot answers ───────────────────────────────
export interface AiTargetingConfig {
  /** 'all' = every conversation; 'rules' = only contacts matching the filters below. */
  mode: TargetingMode;
  /** Tag names the contact MUST have (empty = any). */
  includeTags: string[];
  /** Tag names that exclude a contact (takes precedence over includeTags). */
  excludeTags: string[];
  /** Contact.lifecycleStage values to include (empty = any). */
  lifecycleStages: string[];
  /** New vs returning customers. */
  audience: TargetingAudience;
  /** When true, a per-conversation override (botOverride) wins over these rules. */
  respectPerChatOverride: boolean;
}

export interface AiConfig {
  /** Master switch for the customer-facing WhatsApp bot. */
  enabled: boolean;
  general: AiGeneralSettings;
  personality: AiPersonality;
  businessRules: string[];
  company: AiCompanyKnowledge;
  /** WHAT the business sells — bilingual catalog with options/prices. */
  products: AiProductsConfig;
  sales: AiSalesConfig;
  conversation: AiConversationRules;
  safety: AiSafetyConfig;
  handoff: AiHandoffConfig;
  memory: AiMemoryConfig;
  /** WHEN the bot answers (business hours, rate limits, pause, etc.). */
  gating: AiGatingConfig;
  /** WHICH customers the bot answers (tags, lifecycle, new vs returning). */
  targeting: AiTargetingConfig;
  customVariables: AiCustomVariable[];
  /** Advanced escape hatch — if non-empty, used verbatim instead of the generated prompt. */
  rawPromptOverride: string;
  /** Internal: set once the one-time migration from legacy ChatbotSettings has run. */
  _migratedV2?: boolean;
}

// Legacy shared config from the single-tenant era. Its contents are migrated
// into the Default tenant's per-tenant file once at boot (see seedFromLegacy).
const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'ai-config.json');
const CONFIG_DIR = path.resolve(process.cwd(), 'config');

/** Per-tenant config file path. Each tenant has its own bot persona/behavior. */
function configPathFor(tenantId: string): string {
  // Sanitize to keep the id filesystem-safe.
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(CONFIG_DIR, `ai-config.${safe}.json`);
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  general: {
    model: 'llama-3.3-70b-versatile',
    temperature: 0.6,
    maxTokens: 400,
    responseLength: 'short',
    creativityLevel: 0.5,
    responseSpeed: 'balanced',
  },
  personality: {
    assistantName: '',
    tone: 'professional',
    formality: 0.5,
    emojiUsage: 'low',
    humorLevel: 0.2,
    language: 'auto',
    dialect: 'saudi',
    persona: '',
    writingStyle: '',
  },
  businessRules: [
    'Never invent prices, discounts, or fees you were not given.',
    'Never promise services, products, or delivery dates that are not confirmed available.',
    'Only answer questions within the business scope; politely decline anything else.',
    'Always answer based strictly on the company information provided.',
    'If information is missing, ask a clarifying question instead of guessing.',
    'Refuse unsupported or out-of-scope requests politely.',
  ],
  company: {
    name: '',
    about: '',
    services: '',
    pricing: '',
    faqs: '',
    policies: '',
    workingHours: '',
    locations: '',
    contact: '',
    notes: '',
  },
  products: {
    enabled: true,
    currency: '',
    items: [],
  },
  sales: {
    mode: 'soft',
    leadQualificationQuestions: [],
    bookingFlow: '',
    cta: '',
    upsell: '',
    crossSell: '',
    closing: '',
  },
  conversation: {
    welcomeMessage: '',
    welcomeMessageExact: false,
    maxResponseChars: 0,
    maxSentences: 4,
    useBulletPoints: false,
    alwaysGreet: false,
    alwaysEndWithCta: false,
    useCustomerName: true,
    askFollowUp: true,
    typingStyle: '',
  },
  safety: {
    businessOnlyMode: true,
    refusePolitical: true,
    refuseReligious: true,
    refuseMedical: false,
    refuseLegal: false,
    humanEscalation: true,
    safeMode: true,
    forbiddenTopics: [],
  },
  handoff: {
    enabled: true,
    triggers: {
      complaint: true,
      refund: true,
      manager: true,
      humanAgent: true,
      technicalSupport: false,
    },
    customTriggers: [],
    transferMessage: '',
  },
  memory: {
    contextLength: 6,
    rememberName: true,
    rememberOrders: false,
    rememberPreferences: false,
    persistent: false,
  },
  gating: {
    businessHoursEnabled: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    offHoursMessage: '',
    maxResponsesPerHour: 0,
    batchWindowSeconds: 8,
    ignoreFirstMessage: false,
    typingDelayMs: 0,
    fallbackMessage: '',
    pauseDurationHours: 8,
  },
  targeting: {
    mode: 'all',
    includeTags: [],
    excludeTags: [],
    lifecycleStages: [],
    audience: 'all',
    respectPerChatOverride: true,
  },
  customVariables: [],
  rawPromptOverride: '',
  _migratedV2: false,
};

/** Deep-merge a partial config onto a base, preserving nested defaults. */
export function mergeAiConfig(base: AiConfig, partial: Partial<AiConfig> | null | undefined): AiConfig {
  if (!partial || typeof partial !== 'object') return base;
  return {
    ...base,
    ...partial,
    general: { ...base.general, ...(partial.general ?? {}) },
    personality: { ...base.personality, ...(partial.personality ?? {}) },
    company: { ...base.company, ...(partial.company ?? {}) },
    products: {
      ...base.products,
      ...(partial.products ?? {}),
      // Array of products is replaced wholesale when provided.
      items: partial.products?.items ?? base.products.items,
    },
    sales: { ...base.sales, ...(partial.sales ?? {}) },
    conversation: { ...base.conversation, ...(partial.conversation ?? {}) },
    safety: { ...base.safety, ...(partial.safety ?? {}) },
    handoff: {
      ...base.handoff,
      ...(partial.handoff ?? {}),
      triggers: { ...base.handoff.triggers, ...(partial.handoff?.triggers ?? {}) },
    },
    memory: { ...base.memory, ...(partial.memory ?? {}) },
    gating: { ...base.gating, ...(partial.gating ?? {}) },
    targeting: {
      ...base.targeting,
      ...(partial.targeting ?? {}),
      // Arrays are replaced wholesale when provided.
      includeTags: partial.targeting?.includeTags ?? base.targeting.includeTags,
      excludeTags: partial.targeting?.excludeTags ?? base.targeting.excludeTags,
      lifecycleStages: partial.targeting?.lifecycleStages ?? base.targeting.lifecycleStages,
    },
    // Arrays are replaced wholesale when provided.
    businessRules: partial.businessRules ?? base.businessRules,
    customVariables: partial.customVariables ?? base.customVariables,
  };
}

const LEGACY_SETTINGS_PATH = path.resolve(process.cwd(), 'config', 'chatbot-settings.json');

/**
 * One-time reconciliation from the legacy ChatbotSettings store into this
 * unified config. Reads the legacy JSON directly (no service dependency) and
 * imports only fields that are brand-new here (gating) or still empty here
 * (raw prompt, escalation), so it never clobbers values the admin already set.
 *
 * Crucially it sets the master `enabled` to the legacy value, preserving the
 * CURRENT effective behavior: under the old code the bot's on/off gate was the
 * legacy `enabled` flag, so we don't silently switch the bot on during upgrade.
 */
function migrateFromLegacy(cfg: AiConfig): AiConfig {
  if (cfg._migratedV2) return cfg;

  let legacy: Record<string, unknown> | null = null;
  try {
    if (fs.existsSync(LEGACY_SETTINGS_PATH)) {
      legacy = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_PATH, 'utf-8'));
    }
  } catch (err) {
    logger.warn('ai_config.legacy_read_error', { error: String(err) });
  }

  if (legacy) {
    const str = (k: string) => (typeof legacy![k] === 'string' ? (legacy![k] as string) : '');
    const num = (k: string, d: number) => (typeof legacy![k] === 'number' ? (legacy![k] as number) : d);
    const bool = (k: string, d = false) => (typeof legacy![k] === 'boolean' ? (legacy![k] as boolean) : d);

    // Behavior: import the legacy raw prompt as the override only if none set.
    if (!cfg.rawPromptOverride?.trim() && str('systemPrompt').trim()) {
      cfg.rawPromptOverride = str('systemPrompt');
    }

    // Gating block is brand-new here — always import from legacy.
    cfg.gating = {
      businessHoursEnabled: bool('businessHoursEnabled'),
      businessHoursStart: str('businessHoursStart') || '09:00',
      businessHoursEnd: str('businessHoursEnd') || '18:00',
      offHoursMessage: str('offHoursMessage'),
      maxResponsesPerHour: num('maxResponsesPerHour', 0),
      batchWindowSeconds: num('batchWindowSeconds', 8),
      ignoreFirstMessage: bool('ignoreFirstMessage'),
      typingDelayMs: num('typingDelayMs', 0),
      fallbackMessage: str('fallbackMessage'),
      pauseDurationHours: num('pauseDurationHours', 8),
    };

    // Escalation → handoff (only when handoff has no custom triggers yet).
    if (str('escalationKeywords').trim() && cfg.handoff.customTriggers.length === 0) {
      cfg.handoff.customTriggers = str('escalationKeywords')
        .split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (str('escalationMessage').trim() && !cfg.handoff.transferMessage?.trim()) {
      cfg.handoff.transferMessage = str('escalationMessage');
    }

    // Targeting: replyToAllConversations → 'all', otherwise rule-based.
    cfg.targeting.mode = bool('replyToAllConversations') ? 'all' : 'rules';

    // Master switch: preserve the current effective on/off state.
    cfg.enabled = bool('enabled');
  }

  cfg._migratedV2 = true;
  return cfg;
}

class AiConfigService {
  // One config per tenant. The bot persona/behavior differs per business.
  private cache = new Map<string, AiConfig>();

  /** The scope key for the current tenant (falls back to a shared bucket). */
  private key(): string {
    return getTenantId() ?? '__default__';
  }

  get(): AiConfig {
    const key = this.key();
    const cached = this.cache.get(key);
    if (cached) return cached;

    let cfg: AiConfig;
    const p = configPathFor(key);
    try {
      if (fs.existsSync(p)) {
        cfg = mergeAiConfig(DEFAULT_AI_CONFIG, JSON.parse(fs.readFileSync(p, 'utf-8')));
      } else {
        // Brand-new tenant: start from defaults, no legacy import (legacy is only
        // folded into the Default tenant, once, via seedFromLegacy at boot).
        cfg = { ...DEFAULT_AI_CONFIG, _migratedV2: true };
      }
    } catch (err) {
      logger.warn('ai_config.read_error', { key, error: String(err) });
      cfg = { ...DEFAULT_AI_CONFIG, _migratedV2: true };
    }
    this.cache.set(key, cfg);
    return cfg;
  }

  private persist(key: string, cfg: AiConfig): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(configPathFor(key), JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (err) {
      logger.error('ai_config.write_error', { key, error: String(err) });
    }
  }

  update(partial: Partial<AiConfig>): AiConfig {
    const key = this.key();
    const next = mergeAiConfig(this.get(), partial);
    this.cache.set(key, next);
    this.persist(key, next);
    logger.info('ai_config.updated', { key });
    return next;
  }

  /**
   * One-time boot step: fold the legacy single-tenant config
   * (config/ai-config.json) into the Default tenant's per-tenant file, running
   * the v2 reconciliation. No-op if the tenant already has a file or there is no
   * legacy file. Called from bootstrapDefaultTenant.
   */
  /** Remove a tenant's config (cache + file). Called when a tenant is deleted. */
  remove(tenantId: string): void {
    this.cache.delete(tenantId);
    try {
      const p = configPathFor(tenantId);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      logger.warn('ai_config.remove_failed', { tenantId, error: String(err) });
    }
  }

  seedFromLegacy(tenantId: string): void {
    const p = configPathFor(tenantId);
    try {
      if (fs.existsSync(p)) return; // already has its own config
      if (!fs.existsSync(LEGACY_CONFIG_PATH)) return; // nothing to migrate
      let cfg = mergeAiConfig(DEFAULT_AI_CONFIG, JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf-8')));
      if (!cfg._migratedV2) cfg = migrateFromLegacy(cfg);
      this.persist(tenantId, cfg);
      this.cache.set(tenantId, cfg);
      logger.info('ai_config.seeded_from_legacy', { tenantId });
    } catch (err) {
      logger.warn('ai_config.seed_from_legacy_failed', { tenantId, error: String(err) });
    }
  }
}

export const aiConfigService = new AiConfigService();
