import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { prisma } from '../lib/prisma';
import { runWithTenant } from '../lib/tenant-context';
import { logger } from '../lib/logger';

type KeyBucket = { [id: string]: any };
type KeyStore = Partial<Record<keyof SignalDataTypeMap, KeyBucket>>;

interface StoredAuthData {
  creds?: any;
  keys?: KeyStore;
}

/**
 * Baileys auth state backed by PostgreSQL (WhatsAppSession.data column).
 *
 * Replaces useMultiFileAuthState so the WhatsApp session survives container
 * restarts and ephemeral filesystem deployments. The entire auth state
 * (credentials + signal keys) is serialized into a single JSON column.
 *
 * The in-memory key store is seeded from DB on startup and flushed back on
 * every key mutation and credential save — Baileys calls these infrequently
 * (handshake + periodic key rotations), so the write amplification is low.
 */
export async function clearDbAuthState(sessionId: string): Promise<void> {
  try {
    await prisma.whatsAppSession.delete({ where: { sessionId } }).catch(() => undefined);
  } catch (err) {
    logger.warn('db_auth_state.clear_failed', { sessionId, error: String(err) });
  }
}

export async function useDbAuthState(
  sessionId: string,
  /**
   * The tenant that owns this session. REQUIRED and passed explicitly rather
   * than read from ambient context: Baileys drives most writes from its own
   * socket event loop, where there is no scope to read.
   */
  ownerTenantId: string,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  /**
   * Re-enter the owning tenant's scope for every read and write.
   *
   * Baileys calls `saveCreds` and `keys.set` from its OWN socket event loop —
   * `creds.update`, key rotations, app-state sync — which runs long after the
   * `runWithTenant()` that called `connect()` has exited. `WhatsAppSession` is a
   * tenant-scoped model, so the guard in lib/prisma.ts fails closed there and
   * every one of those writes threw, was swallowed by the catch below, and left
   * only a log line. The session then looked connected (the socket is live in
   * memory) while its credentials and signal keys silently stopped persisting.
   *
   * An earlier version of this fix fell back to `runAsPlatform()` when no tenant
   * was in scope. That was worse than the bug: platform scope bypasses the guard
   * AND skips the tenantId stamp, so it turned a loud failure into a silently
   * ORPHANED session row (tenantId NULL) that `reconnectAll()` and `getSock()`
   * can never see again. Hence the required parameter — there is no longer a
   * code path that can write a tenant-less session.
   *
   * Note the `await` INSIDE the callback: a Prisma promise is lazy, so returning
   * it unawaited would run the query after the scope has already exited.
   */
  const inTenantScope = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithTenant(ownerTenantId, fn);

  async function readRow(): Promise<StoredAuthData> {
    try {
      const row = await inTenantScope(async () =>
        await prisma.whatsAppSession.findUnique({ where: { sessionId } }),
      );
      if (!row?.data || typeof row.data !== 'object') return {};
      return row.data as StoredAuthData;
    } catch (err) {
      logger.warn('db_auth_state.read_failed', { sessionId, error: String(err) });
      return {};
    }
  }

  async function writeRow(data: StoredAuthData): Promise<void> {
    try {
      await inTenantScope(async () => {
        // `tenantId` is written explicitly as well as being stamped by the guard,
        // so the row is correctly owned even if this ever runs under a different
        // scope. An unowned session is unusable — it must never be created.
        await prisma.whatsAppSession.upsert({
          where: { sessionId },
          create: { sessionId, tenantId: ownerTenantId, data: data as any },
          update: { data: data as any },
        });
      });
    } catch (err) {
      logger.error('db_auth_state.write_failed', { sessionId, error: String(err) });
    }
  }

  const stored = await readRow();

  // Rehydrate Buffer objects (Baileys stores keys as binary data).
  const creds: AuthenticationCreds = stored.creds
    ? JSON.parse(JSON.stringify(stored.creds), BufferJSON.reviver)
    : initAuthCreds();

  // In-memory key store seeded from DB. All mutations are flushed immediately.
  const memKeys: KeyStore = stored.keys
    ? JSON.parse(JSON.stringify(stored.keys), BufferJSON.reviver)
    : {};

  async function flush(): Promise<void> {
    await writeRow({
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys: JSON.parse(JSON.stringify(memKeys, BufferJSON.replacer)),
    });
  }

  return {
    state: {
      creds,
      keys: {
        async get<T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
          const bucket = (memKeys[type] ?? {}) as Record<string, SignalDataTypeMap[T]>;
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            if (id in bucket) result[id] = bucket[id];
          }
          return result;
        },

        async set(
          data: { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null } },
        ): Promise<void> {
          for (const [rawType, idMap] of Object.entries(data) as [keyof SignalDataTypeMap, any][]) {
            if (!memKeys[rawType]) (memKeys as any)[rawType] = {};
            for (const [id, value] of Object.entries(idMap ?? {})) {
              if (value == null) {
                delete (memKeys[rawType] as any)[id];
              } else {
                (memKeys[rawType] as any)[id] = value;
              }
            }
          }
          await flush();
        },

        async clear(): Promise<void> {
          for (const type of Object.keys(memKeys) as (keyof SignalDataTypeMap)[]) {
            delete memKeys[type];
          }
          await flush();
        },
      },
    },
    saveCreds: flush,
  };
}
