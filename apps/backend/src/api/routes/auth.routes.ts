import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { env } from '../../lib/env';
import { runAsPlatform } from '../../lib/tenant-context';

const router = Router();

// Authentication is inherently cross-tenant: login looks a user up by email
// across every tenant, and /refresh, /me, and password reset resolve a user by
// a unique token/id before any tenant scope exists. Run the whole auth router in
// platform scope so these User lookups pass the tenant-guard. Every handler here
// only ever touches the User model keyed by unique fields (email/id/resetToken).
router.use((_req, _res, next) => runAsPlatform(() => next()));

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
// Revoked refresh tokens kept until their natural expiry, then pruned so the
// set cannot grow without bound. (For multi-instance deployments this should be
// backed by Redis; see REDIS_URL.)
const revokedRefreshTokens = new Map<string, number>();

function revokeRefreshToken(token: string) {
  let expiryMs = Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000;
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded?.exp) {
    expiryMs = decoded.exp * 1000;
  }
  revokedRefreshTokens.set(token, expiryMs);
  pruneRevokedTokens();
}

function isRefreshTokenRevoked(token: string): boolean {
  pruneRevokedTokens();
  return revokedRefreshTokens.has(token);
}

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [token, expiry] of revokedRefreshTokens) {
    if (expiry <= now) revokedRefreshTokens.delete(token);
  }
}

function getClientKey(req: any) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

function signAccessToken(user: { id: string; email: string; name: string; role?: string; teamId?: string | null; tenantId?: string | null }) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.teamId, tenantId: user.tenantId ?? null },
    env.jwtSecret,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signRefreshToken(user: { id: string; email: string; role?: string; teamId?: string | null; tenantId?: string | null }) {
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, teamId: user.teamId, tenantId: user.tenantId ?? null, tokenId: crypto.randomUUID() },
    env.jwtSecret,
    { expiresIn: `${REFRESH_TOKEN_TTL_SECONDS}s` }
  );
  return refreshToken;
}

// `Secure` is required so the cookie is only sent over HTTPS in production.
const SECURE_COOKIE = env.isProduction ? ' Secure;' : '';

function setRefreshCookie(res: any, token: string) {
  res.setHeader(
    'Set-Cookie',
    `refreshToken=${token}; HttpOnly;${SECURE_COOKIE} Path=/; Max-Age=${REFRESH_TOKEN_TTL_SECONDS}; SameSite=Lax`
  );
}

function clearRefreshCookie(res: any) {
  res.setHeader('Set-Cookie', `refreshToken=; HttpOnly;${SECURE_COOKIE} Path=/; Max-Age=0; SameSite=Lax`);
}

router.post('/register', (_req, res) => {
  return res.status(403).json({ error: 'Public registration is disabled. Contact your administrator to create an account.' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const clientKey = String(getClientKey(req));
    const entry = loginAttempts.get(clientKey);
    if (entry && entry.resetAt > Date.now() && entry.count >= 5) {
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      loginAttempts.set(clientKey, {
        count: (entry?.count || 0) + 1,
        resetAt: entry?.resetAt || Date.now() + 15 * 60 * 1000,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      loginAttempts.set(clientKey, {
        count: (entry?.count || 0) + 1,
        resetAt: entry?.resetAt || Date.now() + 15 * 60 * 1000,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginAttempts.delete(clientKey);

    const token = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    setRefreshCookie(res, refreshToken);

    res.json({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.teamId },
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const headerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;
    const cookieToken = req.headers.cookie?.split(';').find((part: string) => part.trim().startsWith('refreshToken='))
      ?.split('=')[1];
    const refreshToken = headerToken || cookieToken;

    if (!refreshToken || isRefreshTokenRevoked(refreshToken)) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, env.jwtSecret) as { id: string; email: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = signAccessToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.teamId } });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.headers.cookie?.split(';').find((part: string) => part.trim().startsWith('refreshToken='))
      ?.split('=')[1];
    if (refreshToken) {
      revokeRefreshToken(refreshToken);
    }
    clearRefreshCookie(res);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, env.jwtSecret) as { id: string; email: string; name?: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, teamId: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/verify-email', async (req, res) => {
  res.status(501).json({ error: 'Email verification is not implemented yet' });
});

router.post('/forgot-password', async (req, res) => {
  res.status(501).json({ error: 'Password reset request is not implemented yet' });
});

router.post('/reset-password', async (req, res) => {
  res.status(501).json({ error: 'Password reset is not implemented yet' });
});

router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, env.jwtSecret) as { id: string; email: string };
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: decoded.id },
      data: { password: hashedPassword },
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    res.status(500).json({ error: 'Password change failed' });
  }
});

export default router;
