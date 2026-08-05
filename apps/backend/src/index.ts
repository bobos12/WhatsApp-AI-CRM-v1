import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { loadEnv } from './lib/env';
import { logger } from './lib/logger';
import { runAsPlatform } from './lib/tenant-context';
import { sessionManager } from './whatsapp/session-manager';
import { bindRealtimeServer } from './realtime/socket';
import { startSnoozeWakeupScheduler } from './conversations/snooze-wakeup';
import { startBroadcastScheduler } from './broadcasts/broadcast.scheduler';
import { ensureFlowWorker } from './automations/flow-executor';
import { startNoReplyDetector } from './automations/no-reply-detector';
import { aiBotService } from './services/ai-bot.service';
import { GroqBotProvider } from './services/groq-bot.provider';
import { provisionDevSuperuser } from './auth/provision-superuser';
import { provisionPlatformOwner } from './auth/provision-platform-owner';
import { bootstrapDefaultTenant } from './tenants/provision-tenant.service';
import { chatbotSettingsService } from './services/chatbot-settings.service';
import { storageMode, LOCAL_UPLOADS_DIR } from './lib/storage';
import authRoutes from './api/routes/auth.routes';
import whatsappRoutes from './api/routes/whatsapp.routes';
import conversationsRoutes from './api/routes/conversations.routes';
import contactsRoutes from './api/routes/contacts.routes';
import customFieldsRoutes from './api/routes/custom-fields.routes';
import automationsRoutes from './api/routes/automations.routes';
import broadcastsRoutes from './api/routes/broadcasts.routes';
import suppressionRoutes from './api/routes/suppression.routes';
import analyticsRoutes from './api/routes/analytics.routes';
import teamsRoutes from './api/routes/teams.routes';
import tagsRoutes from './api/routes/tags.routes';
import savedRepliesRoutes from './api/routes/saved-replies.routes';
import templatesRoutes from './api/routes/templates.routes';
import dealsRoutes from './api/routes/deals.routes';
import tasksRoutes from './api/routes/tasks.routes';
import usersRoutes from './api/routes/users.routes';
import activityRoutes from './api/routes/activity.routes';
import uploadRoutes from './api/routes/upload.routes';
import chatbotRoutes from './api/routes/chatbot.routes';
import leadsRoutes from './api/routes/leads.routes';
import notificationsRoutes from './api/routes/notifications.routes';
import pushRoutes from './api/routes/push.routes';
import searchRoutes from './api/routes/search.routes';
import platformRoutes from './api/routes/platform.routes';

// Fail fast on missing/weak required configuration before binding the server.
const config = loadEnv();

const app = express();
// Trust the first proxy hop so `req.ip` reflects the real client (X-Forwarded-For)
// behind a load balancer / reverse proxy — required for correct rate limiting.
app.set('trust proxy', 1);
// Don't advertise the framework.
app.disable('x-powered-by');
const server = createServer(app);
const allowedOrigins = new Set([
  config.frontendUrl,
]);

export const io = new Server(server, {
  cors: {
    origin: [...allowedOrigins],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
bindRealtimeServer(io);

// Security headers. `crossOriginResourcePolicy` is relaxed so the frontend
// (a different origin) can load media served from `/uploads`.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.options(
  '*',
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? Number(value) : value,
);
// Contact imports post hundreds of mapped rows per batch, well past the ceiling
// that suits ordinary CRUD. This parser must be mounted *before* the global one:
// `express.json` marks the request as parsed, so whichever runs first wins, and a
// route-level parser mounted later would never see the body. Non-JSON bodies
// (the legacy multipart CSV upload on this same path) fall through untouched.
app.use('/api/contacts/import', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files from local disk only when S3 is not configured (dev mode).
// In production the storage layer writes directly to S3 and returns absolute URLs,
// so the Express static middleware is not needed.
if (storageMode === 'local') {
  if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
    fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(LOCAL_UPLOADS_DIR));
}

// Liveness/readiness probe for load balancers and monitoring. Unauthenticated
// by design; exposes no sensitive data.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Global API rate limit. A per-IP ceiling that protects every endpoint from
// abuse/brute-force; individual routes (e.g. login) add stricter limits on top.
// The ceiling is generous because this is a real-time app: an active dashboard
// legitimately makes many calls (live counts, notifications, and — while the
// WhatsApp QR screen is open — frequent status/QR polling). The lightweight,
// read-only WhatsApp status/QR polls are exempt so keeping that screen open can
// never starve the rest of the API.
const POLL_EXEMPT = /\/api\/whatsapp\/(status|qr)\b/;
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => POLL_EXEMPT.test(req.originalUrl),
  message: { error: 'Too many requests. Please slow down and try again later.' },
});
app.use('/api', apiLimiter);

// Stricter limit on authentication endpoints to blunt credential brute-forcing.
// Successful logins are not counted so normal usage is unaffected.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/custom-fields', customFieldsRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/broadcasts', broadcastsRoutes);
app.use('/api/suppression', suppressionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/saved-replies', savedRepliesRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/platform', platformRoutes);

// ── DEV ONLY: force re-analysis of the most recent 1-to-1 chats. Runs inside
// the live server so lead notifications/popups are pushed over the socket.
// Re-qualifies in newest-first order; only contacts whose status actually
// changes will fire an alert. Remove before production.
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/dev/reanalyze-recent', async (req: Request, res: Response) => {
    const { prisma } = await import('./lib/prisma');
    const { qualifyContact } = await import('./lead-qualification/lead-qualification.service');
    const limit = Math.min(Number(req.query.limit) || 12, 50);
    const convs = await prisma.conversation.findMany({
      where: { isGroup: false },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      select: { contactId: true },
    });
    const ids = [...new Set(convs.map((c) => c.contactId).filter(Boolean))] as string[];
    const results: Array<{ contactId: string; status: string | null; score: number | null }> = [];
    for (const id of ids) {
      try {
        const r = await qualifyContact(id);
        results.push({ contactId: id, status: r?.qualification?.status ?? null, score: r?.qualification?.score ?? null });
      } catch {
        results.push({ contactId: id, status: null, score: null });
      }
    }
    res.json({ requested: ids.length, results });
  });
}

// 404 for unmatched API routes (JSON, not the default HTML page).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler. Logs the full error server-side but never leaks
// stack traces or internal messages to clients in production.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // CORS rejections are client errors, not server faults.
  const isCorsError = err.message?.startsWith('CORS blocked');

  // Errors that already carry a 4xx (body-parser's 413 "request entity too
  // large", malformed JSON, and any HttpError that escaped a route) describe
  // something the caller did. Reporting them as 500 tells the user the server
  // broke when their file was simply too big.
  const carried = (err as Error & { status?: number; statusCode?: number });
  const declared = carried.status ?? carried.statusCode;
  const isClientError = typeof declared === 'number' && declared >= 400 && declared < 500;

  const status = isCorsError ? 403 : isClientError ? declared! : 500;

  logger.error('Unhandled request error', {
    method: req.method,
    path: req.path,
    status,
    message: err.message,
    ...(config.isProduction ? {} : { stack: err.stack }),
  });
  if (res.headersSent) return;
  res.status(status).json({
    error:
      status >= 500 ? 'Internal server error'
      : isCorsError ? 'Request blocked'
      : err.message,
  });
});

const PORT = config.port;

server.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);

  // Boot-time work runs above any single tenant (guard bypassed): it provisions
  // platform identities, reads shared settings, and starts schedulers that must
  // scan every tenant. Per-tenant narrowing happens inside each scheduler tick
  // and inbound handler. AsyncLocalStorage propagates this platform scope into
  // the timers/handlers created here.
  await runAsPlatform(async () => {
    // Load chatbot settings from DB before serving any AI traffic.
    await chatbotSettingsService.init();

    // Ensure the platform identities exist, then fold any pre-multitenant data
    // into the default tenant and seed its owner — all before serving traffic.
    // Await the dev super-account first so the backfill can fold it into the
    // default tenant (it runs the business AND operates the platform).
    await provisionDevSuperuser();
    provisionPlatformOwner();
    await bootstrapDefaultTenant();
    startSnoozeWakeupScheduler();
    // Dispatches SCHEDULED broadcasts whose time has come, and recovers any run
    // interrupted by a restart. Must start before traffic so a schedule that fell
    // due while the process was down fires on the first tick.
    startBroadcastScheduler();
    ensureFlowWorker();
    startNoReplyDetector();
    aiBotService.register(new GroqBotProvider());
    if (process.env.WHATSAPP_AUTO_CONNECT !== 'false') {
      // Reconnect every ACTIVE tenant that already has a stored WhatsApp session.
      sessionManager.reconnectAll().catch((err: Error) => {
        console.error('WhatsApp reconnect-all failed:', err.message);
      });
    }
  });
});
