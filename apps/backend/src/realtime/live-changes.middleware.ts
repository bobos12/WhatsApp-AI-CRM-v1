import type { NextFunction, Request, Response } from 'express';
import { emitDataChanged } from './socket';

/**
 * Announce every successful change made through the API.
 *
 * Runs once for all routes, so a new screen or endpoint is live without anyone
 * remembering to add an emit: `POST /api/contacts` → `data:changed contacts`,
 * `PUT /api/templates/abc` → `data:changed templates abc`. The tenant comes
 * from the authenticated user, read when the response finishes.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Requests that change nothing anyone else is looking at. */
const QUIET = [
  /^\/api\/auth\//,
  /^\/api\/push\//,
  /^\/api\/upload/,
  /^\/api\/search/,
  /^\/api\/analytics/,
  /^\/api\/broadcasts\/preflight/,
  /^\/api\/conversations\/[^/]+\/typing/,
  // Chat traffic: the inbox patches itself from message:new / message:status.
  // Announcing it made every open leads and contact page reload in full on
  // every message sent and every chat opened.
  /^\/api\/conversations\/[^/]+\/(read|reply|interactive|messages\/)/,
  /^\/api\/conversations\/[^/]+\/bot\/(simulate|test)/,
  /^\/api\/whatsapp\/meta-webhook/,
];

export function liveChanges(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING.has(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (QUIET.some((pattern) => pattern.test(path))) return next();

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const tenantId = (req as Request & { user?: { tenantId?: string | null } }).user?.tenantId;
    if (!tenantId) return;
    const [, , resource, id] = path.split('/'); // '', 'api', resource, id
    if (resource) emitDataChanged(resource, id ?? null, tenantId);
  });
  next();
}
