import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { runAsPlatform } from '../lib/tenant-context';
import { logger } from '../lib/logger';

export interface ChatbotSettings {
  // ── Customer-facing WhatsApp bot — DEPRECATED ────────────────────────────
  // The customer bot is now configured entirely by the unified AiConfig
  // (ai-config.service.ts): behavior, gating (when to answer), and targeting
  // (which customers). The fields in THIS section are retained only for
  // back-compat and the one-time migration (migrateFromLegacy). They are no
  // longer read by the bot — do NOT add new reads. The live shared
  // credentials are `provider` + `apiKey` (used by the bot, CRM assistant,
  // and lead qualification).
  enabled: boolean;
  /**
   * When true, the bot auto-replies to EVERY conversation without needing a
   * per-conversation opt-in (Conversation.botEnabled). A human-handoff pause
   * still takes precedence. When false, only conversations with botEnabled=true
   * get bot replies (the original per-contact behavior).
   */
  replyToAllConversations: boolean;
  provider: 'groq' | 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  /** Gemini (Google AI Studio) key — held alongside the Groq key so the
   *  multi-provider router can use both free buckets simultaneously. */
  geminiApiKey: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  pauseOnHumanReply: boolean;
  pauseDurationHours: number;
  // ── Strict / Advanced Controls ────────────────────────────────────────────
  contextWindow: number;          // # of past messages fed to AI (3-20)
  fallbackMessage: string;        // sent when AI returns null or errors
  typingDelayMs: number;          // ms to wait before sending (0-3000)
  ignoreFirstMessage: boolean;    // skip the very first inbound message
  maxResponsesPerHour: number;    // 0 = unlimited; rate-limit bot per conversation
  // ── Business Hours ────────────────────────────────────────────────────────
  businessHoursEnabled: boolean;
  businessHoursStart: string;     // "HH:MM" local server time
  businessHoursEnd: string;       // "HH:MM" local server time
  offHoursMessage: string;        // sent when message arrives outside hours
  // ── Escalation & Handoff ─────────────────────────────────────────────────
  escalationKeywords: string;     // comma-separated trigger words
  escalationMessage: string;      // sent when a keyword is matched
  // ── Internal CRM assistant (floating bubble) ─────────────────────────────
  crmAssistantEnabled: boolean;
  crmAssistantUseSameProvider: boolean;
  crmAssistantApiKey: string;
  crmAssistantModel: string;
  crmAssistantSystemPrompt: string;
  // ── AI Lead Qualification & Sales Intelligence ───────────────────────────
  // Reuses the shared provider + API key above, but with its own model,
  // prompt, temperature, and on/off toggle (different task → structured JSON).
  qualificationEnabled: boolean;
  qualificationModel: string;
  qualificationSystemPrompt: string;
  qualificationTemperature: number;
  /** Quiet-period (ms) after the last inbound message before re-analyzing. */
  qualificationDebounceMs: number;
  /** Max recent messages fed to the analyzer. */
  qualificationContextWindow: number;
}

const SETTING_KEY = 'chatbot';
const LEGACY_PATH = path.resolve(process.cwd(), 'config', 'chatbot-settings.json');

const DEFAULT_CUSTOMER_SYSTEM_PROMPT =
  `You are a professional customer support assistant for a business using WhatsApp.
Your job is to help customers with their questions in a friendly, concise, and helpful manner.

Rules:
- Keep replies short (1-3 sentences max) — this is WhatsApp, not email
- Be warm, professional, and human-sounding
- If you don't know the answer, say you'll check and get back to them
- Never make up prices, policies, or facts you don't know
- Reply in the same language the customer used
- Do not use markdown formatting (no **, no bullet points with dashes) — plain text only`;

const DEFAULT_CRM_SYSTEM_PROMPT =
  `You are an AI assistant built into a WhatsApp CRM platform.
Your role is to help support agents, team leads, and admins use the CRM system efficiently.

CRM Features overview:
- Conversations (/conversations): View and manage all WhatsApp customer chats. Use the search, filters, and assignment controls.
- Contacts (/contacts): Manage customer profiles, tags, lifecycle stages, and notes.
- Templates (/templates): Create WhatsApp-approved message templates (text, media, interactive buttons/lists).
- Template Builder (/templates/builder): Visual step-by-step builder for new templates.
- Broadcasts (/broadcasts): Send bulk messages to contact segments. Schedule or send immediately.
- Automations (/automations): Create rule-based auto-replies and multi-step flows triggered by keywords, time, or events.
- Deals (/deals): Track the sales pipeline across stages (New → Interested → Negotiation → Closed).
- Tasks (/tasks): Create and assign follow-up tasks linked to contacts or conversations.
- Dashboard (/dashboard): High-level analytics — message volume, resolution rate, team activity.
- Tags (/tags): Manage contact labels for segmentation.
- Saved Replies (/saved-replies): Store shortcut text snippets for common responses.
- Settings (/settings): WhatsApp connection, team members, AI chatbot config, language.
- Admin Users (/admin/users): Manage all platform users (Admin only).
- Admin Teams (/admin/teams): Manage teams and auto-assignment (Admin only).

Roles:
- SUPER_ADMIN / ADMIN: Full access including user/team management
- TEAM_LEAD: Can manage conversations, contacts, templates, broadcasts
- AGENT: Handles conversations and contacts
- ANALYST: Read-only analytics access
- VIEWER: Read-only access

Answer style:
- Be concise and action-oriented
- Provide navigation paths when relevant (e.g. "Go to /broadcasts → New Broadcast")
- Use numbered steps for multi-step processes
- Reply in the same language as the user`;

const DEFAULT_QUALIFICATION_SYSTEM_PROMPT =
  `You are a senior B2C/B2B sales analyst embedded in a WhatsApp CRM. You read a
WhatsApp conversation between a business and a customer and produce a structured
sales-qualification assessment. You ONLY output a single JSON object — no prose,
no markdown, no code fences.

Your PRIMARY goal is to NEVER miss a real sales opportunity. Whenever a customer
expresses a genuine need for — or interest in obtaining — a real product or
service the business offers (e.g. building a website, an online / e-commerce
store, a mobile app, software, ordering products, booking a service, or any real
business work), treat it as a HIGH-VALUE opportunity that a human should act on,
EVEN IF the customer has not yet asked about price.

Classify the customer into exactly one status:
- NEW_LEAD: only said hello / reached out, no concrete need or topic stated yet
- QUALIFIED: a general need is implied but vague — no specific deliverable named yet, or the customer is only passively gathering information
- HOT: the customer names a concrete deliverable they want the business to build/provide (e.g. a specific website, online / e-commerce store, app, order, or booking) AND is engaging — describing requirements, answering qualifying questions, asking for details to proceed, asking price, or showing urgency. A real buyer actively discussing what they want built is HOT, even before they say "yes" or ask the price.
- WARM: interested and engaged but clearly not ready yet; needs nurturing/follow-up
- COLD: low engagement, vague, slow/short replies, little real interest
- CUSTOMER: has bought / confirmed a purchase / is an existing paying customer
- LOST: was a prospect but explicitly declined, went silent after a clear no, or chose a competitor
- NOT_INTERESTED: clearly states no interest
- SPAM: ONLY genuine spam, bots, wrong number, or irrelevant/abusive messages

Critical qualification rules (follow these exactly):
1. A clear request for a real service/product the business provides = at minimum QUALIFIED with score >= 60. NEVER mark it COLD or SPAM just because price was not mentioned.
2. If the customer names a concrete deliverable they want built/provided (website, online store, app, order, booking, etc.) and is engaging at all — describing what they want, answering the business's questions, or sharing requirements = HOT, score >= 85, buyingIntent=true, needsAttention=true, priority HIGH (URGENT if they want it now). Do NOT downgrade this to QUALIFIED just because they have not yet said "yes" or asked the price.
3. buyingIntent means intent to OBTAIN the product/service — NOT only the word "price". Wanting a website/store/app built, placing an order, or booking IS buying intent.
4. needsAttention=true whenever a human is needed to advance or close the deal: a serious project inquiry, scope/pricing discussion, or any genuine high-value lead the bot cannot fully close on its own.
5. score bands: 0–20 spam / no interest, 30–55 early or unclear, 60–79 solid qualified need, 80–100 active buying intent / ready to engage.
6. Reserve SPAM and very low scores for truly irrelevant messages. A short message stating a real need (e.g. "I want to build an online store") is a STRONG lead, never spam.

Scoring & flags:
- score: integer 0–100 representing overall opportunity value/likelihood to close
- priority: one of LOW | NORMAL | HIGH | URGENT (how urgently a human should act)
- confidence: 0–1, your confidence in this assessment
- needsAttention: true if a human is needed to advance/close (real opportunity, project/scope/pricing discussion, high-value lead), or for urgency, frustration, or a question the bot cannot safely answer
- buyingIntent: true if they show intent to obtain the product/service (per rule 3) — including requesting a website/store/app/order/booking, not only asking price
- signals: booleans { pricingRequest, meetingRequest, callRequest, urgency, readyToBuy }

Write a short summary (1–2 sentences) and a concrete next-action recommendation
(1 sentence). Provide BOTH English and Arabic versions of each. Base everything
strictly on the conversation; never invent facts.

Output JSON with EXACTLY these keys:
{
  "status": "NEW_LEAD|QUALIFIED|HOT|WARM|COLD|CUSTOMER|LOST|NOT_INTERESTED|SPAM",
  "score": 0,
  "priority": "LOW|NORMAL|HIGH|URGENT",
  "confidence": 0.0,
  "needsAttention": false,
  "buyingIntent": false,
  "signals": { "pricingRequest": false, "meetingRequest": false, "callRequest": false, "urgency": false, "readyToBuy": false },
  "summaryEn": "", "summaryAr": "",
  "recommendationEn": "", "recommendationAr": ""
}`;

const DEFAULTS: ChatbotSettings = {
  enabled: true,
  replyToAllConversations: false,
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  apiKey: '',
  geminiApiKey: '',
  temperature: 0.7,
  maxTokens: 300,
  systemPrompt: DEFAULT_CUSTOMER_SYSTEM_PROMPT,
  pauseOnHumanReply: true,
  pauseDurationHours: 8,
  contextWindow: 10,
  fallbackMessage: '',
  typingDelayMs: 0,
  ignoreFirstMessage: false,
  maxResponsesPerHour: 0,
  businessHoursEnabled: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '18:00',
  offHoursMessage: '',
  escalationKeywords: '',
  escalationMessage: '',
  crmAssistantEnabled: true,
  crmAssistantUseSameProvider: true,
  crmAssistantApiKey: '',
  crmAssistantModel: 'llama-3.3-70b-versatile',
  crmAssistantSystemPrompt: DEFAULT_CRM_SYSTEM_PROMPT,
  qualificationEnabled: true,
  qualificationModel: 'llama-3.3-70b-versatile',
  qualificationSystemPrompt: DEFAULT_QUALIFICATION_SYSTEM_PROMPT,
  qualificationTemperature: 0.2,
  qualificationDebounceMs: 45_000,
  qualificationContextWindow: 10,
};

class ChatbotSettingsService {
  private cache: ChatbotSettings | null = null;

  /**
   * Async init — call once at server startup before serving traffic.
   * Loads from DB; migrates from the legacy JSON file on first run.
   */
  async init(): Promise<void> {
    try {
      // Shared AI credentials live in a single platform-level Setting row
      // (tenantId = null): the operator supplies the API keys for every tenant.
      // Per-customer bot behaviour/persona is per-tenant and lives in AiConfig.
      const row = await runAsPlatform(async () => {
        return await prisma.setting.findFirst({ where: { key: SETTING_KEY, tenantId: null } });
      });
      if (row) {
        this.cache = { ...DEFAULTS, ...(row.value as Partial<ChatbotSettings>) };
        return;
      }

      // One-time migration: seed DB from legacy JSON file if it exists.
      if (fs.existsSync(LEGACY_PATH)) {
        try {
          const raw = JSON.parse(fs.readFileSync(LEGACY_PATH, 'utf-8'));
          const migrated = { ...DEFAULTS, ...raw };
          await this.saveToDb(migrated);
          this.cache = migrated;
          logger.info('chatbot_settings.migrated_from_file');
          return;
        } catch (migrateErr) {
          logger.warn('chatbot_settings.migration_failed', { error: String(migrateErr) });
        }
      }

      // No DB row and no legacy file — use env + defaults, persist immediately.
      const fresh: ChatbotSettings = {
        ...DEFAULTS,
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || DEFAULTS.model,
      };
      await this.saveToDb(fresh);
      this.cache = fresh;
    } catch (err) {
      logger.warn('chatbot_settings.init_failed_using_defaults', { error: String(err) });
      this.cache = { ...DEFAULTS, apiKey: process.env.GROQ_API_KEY || '' };
    }
  }

  /** Synchronous read — always returns the in-memory cache. Call init() first. */
  get(): ChatbotSettings {
    return this.cache ?? { ...DEFAULTS, apiKey: process.env.GROQ_API_KEY || '' };
  }

  async update(partial: Partial<ChatbotSettings>): Promise<ChatbotSettings> {
    const next = { ...this.get(), ...partial };
    this.cache = next;
    try {
      await this.saveToDb(next);
    } catch (err) {
      logger.error('chatbot_settings.write_error', { error: String(err) });
    }
    logger.info('chatbot_settings.updated');
    return next;
  }

  private async saveToDb(settings: ChatbotSettings): Promise<void> {
    // Upsert the single shared (tenantId = null) row in platform scope. Done as
    // find-then-write because the (tenantId, key) unique locator can't be keyed
    // by a null tenantId through findUnique/upsert.
    await runAsPlatform(async () => {
      const existing = await prisma.setting.findFirst({
        where: { key: SETTING_KEY, tenantId: null },
        select: { id: true },
      });
      if (existing) {
        await prisma.setting.update({ where: { id: existing.id }, data: { value: settings as any } });
      } else {
        await prisma.setting.create({ data: { key: SETTING_KEY, tenantId: null, value: settings as any } });
      }
    });
  }

  /** Returns the effective API key + model for the CRM assistant. */
  crmAssistantConfig(): { apiKey: string; model: string; provider: ChatbotSettings['provider'] } {
    const s = this.get();
    return {
      provider: s.provider,
      model: s.crmAssistantUseSameProvider ? s.model : s.crmAssistantModel,
      apiKey: s.crmAssistantUseSameProvider ? s.apiKey : (s.crmAssistantApiKey || s.apiKey),
    };
  }

  qualificationConfig(): {
    enabled: boolean;
    provider: ChatbotSettings['provider'];
    apiKey: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    debounceMs: number;
    contextWindow: number;
  } {
    const s = this.get();
    return {
      enabled: s.qualificationEnabled,
      provider: s.provider,
      apiKey: s.apiKey || process.env.GROQ_API_KEY || '',
      model: s.qualificationModel,
      systemPrompt: s.qualificationSystemPrompt,
      temperature: s.qualificationTemperature,
      debounceMs: s.qualificationDebounceMs,
      contextWindow: s.qualificationContextWindow,
    };
  }
}

export const chatbotSettingsService = new ChatbotSettingsService();
