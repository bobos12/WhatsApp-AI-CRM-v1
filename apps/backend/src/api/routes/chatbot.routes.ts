import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../../auth/auth.middleware';
import { chatbotSettingsService, ChatbotSettings } from '../../services/chatbot-settings.service';
import {
  aiConfigService,
  mergeAiConfig,
  DEFAULT_AI_CONFIG,
  type AiConfig,
} from '../../services/ai-config.service';
import { buildSystemPrompt, estimateTokens, buildConfigSummary, substituteVariables } from '../../services/ai-prompt-builder';
import { AI_CONFIG_TEMPLATES } from '../../services/ai-config-templates';
import { callChatModel } from '../../lib/chat-model';
import { getModelStatus } from '../../lib/groq-fallback';
import { getGeminiStatus } from '../../lib/gemini-provider';
import { routeChat, routerChains, routerGeminiModels } from '../../services/model-router';
import { logger } from '../../lib/logger';

const router = Router();

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return '****' + key.slice(-4);
}

function safeSettings(s: ChatbotSettings) {
  return {
    ...s,
    apiKey: maskKey(s.apiKey),
    geminiApiKey: maskKey(s.geminiApiKey),
    crmAssistantApiKey: maskKey(s.crmAssistantApiKey),
  };
}

// ── GET /api/chatbot/settings ─────────────────────────────────────────────────
router.get('/settings', authMiddleware, (_req: Request, res: Response) => {
  res.json(safeSettings(chatbotSettingsService.get()));
});

// ── GET /api/chatbot/status — at-a-glance health for the unified AI page ───────
router.get('/status', authMiddleware, (_req: Request, res: Response) => {
  const s = chatbotSettingsService.get();
  const aiConfig = aiConfigService.get();
  // Customer-bot state now lives entirely on the unified AiConfig.
  const botModel = aiConfig.general.model || s.model;
  res.json({
    provider: s.provider,
    hasApiKey: Boolean(s.apiKey || process.env.GROQ_API_KEY),
    hasGeminiKey: Boolean(s.geminiApiKey || process.env.GEMINI_API_KEY),
    customerBot: {
      enabled: aiConfig.enabled,
      replyToAll: aiConfig.targeting.mode === 'all',
      targetingMode: aiConfig.targeting.mode,
      model: botModel,
    },
    crmAssistant: { enabled: s.crmAssistantEnabled, model: s.crmAssistantUseSameProvider ? s.model : s.crmAssistantModel },
    leadQualification: { enabled: s.qualificationEnabled, model: s.qualificationModel, debounceSeconds: Math.round((s.qualificationDebounceMs || 45000) / 1000) },
    // Live free-bucket status per provider for the quota meter.
    models: getModelStatus(botModel),
    geminiModels: (s.geminiApiKey || process.env.GEMINI_API_KEY)
      ? getGeminiStatus(routerGeminiModels())
      : [],
    // Which model each feature uses, in fallback order (single source: the router).
    routing: routerChains(),
  });
});

// ── GET /api/chatbot/targeting-options — tags + lifecycle stages for the UI ────
// Feeds the Audience panel's tag multi-select and lifecycle-stage chips.
router.get('/targeting-options', authMiddleware, async (_req: Request, res: Response) => {
  const { prisma } = await import('../../lib/prisma');
  try {
    const [tags, stageRows] = await Promise.all([
      prisma.tag.findMany({ select: { name: true }, orderBy: { name: 'asc' } }),
      prisma.contact.findMany({ select: { lifecycleStage: true }, distinct: ['lifecycleStage'] }),
    ]);
    const tagNames = Array.from(new Set(tags.map((t) => t.name))).filter(Boolean);
    // Always offer the standard stages, plus any custom ones already in use.
    const standardStages = ['LEAD', 'QUALIFIED', 'HOT', 'WARM', 'COLD', 'CUSTOMER', 'LOST'];
    const usedStages = stageRows.map((r) => r.lifecycleStage).filter(Boolean);
    const lifecycleStages = Array.from(new Set([...standardStages, ...usedStages]));
    res.json({ tags: tagNames, lifecycleStages });
  } catch (err) {
    logger.error('chatbot.targeting_options_error', { error: String(err) });
    res.status(500).json({ error: 'Failed to load targeting options' });
  }
});

// ── PUT /api/chatbot/settings (admin only) ────────────────────────────────────
router.put('/settings', requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as Partial<ChatbotSettings>;

  // If user sent a masked placeholder, keep the existing key
  const current = chatbotSettingsService.get();
  if (body.apiKey?.startsWith('****')) body.apiKey = current.apiKey;
  if (body.geminiApiKey?.startsWith('****')) body.geminiApiKey = current.geminiApiKey;
  if (body.crmAssistantApiKey?.startsWith('****')) body.crmAssistantApiKey = current.crmAssistantApiKey;

  const updated = await chatbotSettingsService.update(body);
  res.json(safeSettings(updated));
});

// ── POST /api/chatbot/chat (CRM assistant) ────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DIALECT_INSTRUCTIONS: Record<string, string> = {
  ar: '\n\n[مهم: يجب الرد دائماً باللهجة العامية السعودية. استخدم لغة طبيعية وبسيطة مثل ما يتكلم السعوديون في حياتهم اليومية. تجنب الفصحى الرسمية إلا عند الحاجة.]',
};

router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  const { message, history = [], locale } = req.body as {
    message: string;
    history?: ChatMessage[];
    locale?: string;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const settings = chatbotSettingsService.get();

  if (!settings.crmAssistantEnabled) {
    return res.status(503).json({ error: 'CRM Assistant is disabled' });
  }

  if (!settings.apiKey && !settings.geminiApiKey && !process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'No API key configured. Set a Groq or Gemini key in AI settings.',
    });
  }

  const basePrompt =
    settings.crmAssistantUseSameProvider
      ? settings.crmAssistantSystemPrompt
      : (settings.crmAssistantSystemPrompt || settings.systemPrompt);

  const dialectSuffix = locale && DIALECT_INSTRUCTIONS[locale] ? DIALECT_INSTRUCTIONS[locale] : '';
  const systemPrompt = basePrompt + dialectSuffix;

  const safeHistory = (Array.isArray(history) ? history : []).slice(-12);

  try {
    // CRM assistant runs on its own free lane (Groq 8B → Gemini Flash-Lite).
    const { content: reply } = await routeChat('assistant', {
      systemPrompt,
      messages: [...safeHistory, { role: 'user', content: message }],
      temperature: settings.temperature ?? 0.7,
      maxTokens: 1024,
    });
    if (!reply) return res.status(502).json({ error: 'Empty response from AI provider' });
    res.json({ reply });
  } catch (err) {
    logger.error('chatbot.crm_assistant_error', { error: String(err) });
    res.status(500).json({ error: 'Failed to generate reply. Check your API key and model.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI Configuration (structured prompt builder for the customer bot)
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/chatbot/ai-config ────────────────────────────────────────────────
router.get('/ai-config', authMiddleware, (_req: Request, res: Response) => {
  res.json(aiConfigService.get());
});

// ── PUT /api/chatbot/ai-config (admin only) ───────────────────────────────────
router.put('/ai-config', requireAdmin, (req: Request, res: Response) => {
  const updated = aiConfigService.update(req.body as Partial<AiConfig>);
  // Broadcast the master-switch state so the chat header and any open settings
  // tab reflect the change live (system-wide config → global emit).
  try {
    const { emitRealtime } = require('../../realtime/socket');
    emitRealtime('aiConfig:updated', { enabled: updated.enabled });
  } catch { /* realtime optional */ }
  res.json(updated);
});

// ── POST /api/chatbot/ai-config/preview ───────────────────────────────────────
// Builds the system prompt from a posted (unsaved) config. Used by the live
// preview panel so the admin sees exactly what the bot will receive.
router.post('/ai-config/preview', authMiddleware, (req: Request, res: Response) => {
  const cfg = mergeAiConfig(DEFAULT_AI_CONFIG, (req.body?.config ?? req.body) as Partial<AiConfig>);
  const systemPrompt = buildSystemPrompt(cfg);
  res.json({
    systemPrompt,
    estimatedTokens: estimateTokens(systemPrompt),
    summary: buildConfigSummary(cfg),
  });
});

// ── POST /api/chatbot/ai-config/playground (admin only) ───────────────────────
// Sends a test message against a posted (unsaved) config so admins can compare
// configurations without saving. Uses the customer bot's provider + API key.
router.post('/ai-config/playground', requireAdmin, async (req: Request, res: Response) => {
  const { config, message, history = [] } = req.body as {
    config?: Partial<AiConfig>;
    message?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

  const cfg = mergeAiConfig(DEFAULT_AI_CONFIG, config);
  const settings = chatbotSettingsService.get();
  if (!settings.apiKey && !settings.geminiApiKey && !process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'No API key configured. Set a Groq or Gemini key in AI settings.' });
  }

  const safeHistory = (Array.isArray(history) ? history : []).slice(-12);
  const isFirst = safeHistory.length === 0;

  // Mirror production: on the first message, the welcome is sent verbatim by
  // code (never reworded), so the tester sees exactly what a customer gets.
  const welcome = cfg.conversation.welcomeMessage?.trim();
  if (isFirst && welcome) {
    const text = substituteVariables(welcome, cfg, { companyName: cfg.company.name || undefined });
    return res.json({ reply: text, systemPrompt: buildSystemPrompt(cfg, { isFirstMessage: true }), estimatedTokens: 0 });
  }

  const systemPrompt = buildSystemPrompt(cfg, { isFirstMessage: isFirst });

  try {
    // Route through the same multi-provider chain as production (Gemini → Groq).
    const { reply, provider, model } = await routeChat('bot', {
      systemPrompt,
      messages: [...safeHistory, { role: 'user', content: message }],
      temperature: cfg.general.temperature,
      maxTokens: cfg.general.maxTokens,
    }).then((r) => ({ reply: r.content, provider: r.provider, model: r.model }));
    if (!reply) return res.status(502).json({ error: 'Empty response from AI provider' });
    res.json({ reply, provider, model, systemPrompt, estimatedTokens: estimateTokens(systemPrompt) });
  } catch (err) {
    logger.error('chatbot.ai_config_playground_error', { error: String(err) });
    res.status(500).json({ error: 'Failed to generate reply. Check your API key and model.' });
  }
});

// ── GET /api/chatbot/ai-config/templates ──────────────────────────────────────
router.get('/ai-config/templates', authMiddleware, (_req: Request, res: Response) => {
  res.json(AI_CONFIG_TEMPLATES);
});

export default router;
