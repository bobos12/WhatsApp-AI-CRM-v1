import type { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { isManager } from '../auth/authorize';
import { getTenantId, runAsPlatform } from '../lib/tenant-context';

let socketServer: SocketIOServer | null = null;

type SocketUser = { id: string; teamId: string | null; tenantId: string | null; role?: string };

/**
 * Room naming — every room is namespaced under the socket's tenant so an event
 * emitted for one tenant can never reach another's sockets:
 *   tenant:<t>                 — every user in the tenant (tenant-wide events)
 *   tenant:<t>:team:<team>     — one team inside the tenant
 *   tenant:<t>:managers        — managers inside the tenant (see all teams' events)
 *   user:<id>                  — a single user's devices (direct notifications)
 * Platform identities (tenantId === null) receive no tenant-scoped events.
 */
export function bindRealtimeServer(server: SocketIOServer) {
  socketServer = server;

  server.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Unauthorized'));

      const decoded = jwt.verify(token, env.jwtSecret) as { id: string };
      // The lookup precedes any tenant scope, so it runs in platform scope.
      // The await must be INSIDE the scope — a lazy Prisma query awaited outside
      // would run with no context and trip the guard.
      const user = await runAsPlatform(async () => {
        return await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { id: true, email: true, name: true, role: true, teamId: true, tenantId: true },
        });
      });

      if (!user) return next(new Error('Unauthorized'));

      socket.data.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  server.on('connection', (socket) => {
    const user = socket.data.user as SocketUser;
    const tenantPrefix = user.tenantId ? `tenant:${user.tenantId}` : null;

    // Tenant-scoped rooms. A user with no tenant (platform identity) only gets
    // their personal room and never any tenant data.
    if (tenantPrefix) {
      socket.join(tenantPrefix);
      if (user.teamId) socket.join(`${tenantPrefix}:team:${user.teamId}`);
      // Managers see every team's events *within their tenant*.
      if (isManager(user.role)) socket.join(`${tenantPrefix}:managers`);
    }
    // Personal room for direct notifications.
    socket.join(`user:${user.id}`);

    // ── Typing indicator relay (scoped to the sender's tenant + team) ────────
    socket.on('typing:start', (data: { conversationId: string }) => {
      if (!tenantPrefix || !user.teamId) return;
      socket.to(`${tenantPrefix}:team:${user.teamId}`).to(`${tenantPrefix}:managers`).emit('typing:start', {
        conversationId: data.conversationId,
        userId: user.id,
      });
    });

    socket.on('typing:stop', (data: { conversationId: string }) => {
      if (!tenantPrefix || !user.teamId) return;
      socket.to(`${tenantPrefix}:team:${user.teamId}`).to(`${tenantPrefix}:managers`).emit('typing:stop', {
        conversationId: data.conversationId,
        userId: user.id,
      });
    });

    // ── Gap detection: client missed events, requests replay ────────────────
    socket.on('resync', (req: { fromSeq: number; limit?: number }) => {
      if (!user.teamId) return;
      const { getEventsSince, getLatestSeq } = require('./event-bus');
      const events = getEventsSince(user.teamId, req.fromSeq ?? 0, req.limit ?? 200);
      const latestSeq = getLatestSeq(user.teamId);
      socket.emit('resync.batch', { events, hasMore: false, latestSeq });
    });
  });
}

/**
 * Emit a realtime event, fenced to the tenant in the current context.
 *
 * The tenant is read from the ambient TenantContext (lib/tenant-context.ts), so
 * callers never pass it and can never target the wrong tenant. Within the
 * tenant, a `teamId` narrows delivery to that team + the tenant's managers;
 * omitting it delivers to every user in the tenant (tenant-wide events like
 * wa:status / wa:qr). With no tenant in context (system/boot) nothing is sent —
 * tenant data is never broadcast globally.
 */
export function emitRealtime(event: string, payload: unknown, teamId?: string | null) {
  if (!socketServer) return;
  const tenantId = getTenantId();
  if (!tenantId) return;
  const base = `tenant:${tenantId}`;
  if (teamId) {
    // Deliver to the team room AND the tenant's managers room. socket.io
    // de-duplicates, so a manager who is also in that team receives it once.
    socketServer.to(`${base}:team:${teamId}`).to(`${base}:managers`).emit(event, payload);
  } else {
    socketServer.to(base).emit(event, payload);
  }
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  socketServer?.to(`user:${userId}`).emit(event, payload);
}

export function getRealtimeServer() {
  return socketServer;
}
