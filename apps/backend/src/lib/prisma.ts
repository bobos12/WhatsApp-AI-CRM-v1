import { PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenant-context';

/**
 * Models that carry a `tenantId` column and MUST be fenced to the current
 * tenant. Keep this list in sync with schema.prisma: every model with a
 * `tenantId` field belongs here.
 *
 * Deliberately NOT listed (no tenantId column — access is indirect through a
 * guarded parent): Tenant, PushSubscription (via User), ContactTag (via
 * Contact/Tag), AutomationFlowStep (via AutomationFlow).
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Team',
  'WhatsAppSession',
  'Contact',
  'CustomFieldDefinition',
  'Tag',
  'Conversation',
  'Message',
  'MessageReaction',
  'InternalNote',
  'AutomationRule',
  'AutomationFlow',
  'AutomationFlowExecution',
  'Broadcast',
  'BroadcastRecipient',
  'SuppressionEntry',
  'AccountHealthDay',
  'Analytics',
  'AuditLog',
  'SavedReply',
  'Deal',
  'MessageTemplate',
  'Task',
  'LeadQualification',
  'LeadStatusEvent',
  'Notification',
  'Setting',
]);

/** Operations that accept a `where` we can inject the tenant filter into. */
const WHERE_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const base = new PrismaClient();

/**
 * The tenant-guarded Prisma client. A single query extension reads the ambient
 * TenantContext (lib/tenant-context.ts) and, for every tenant-scoped model:
 *   - injects `where: { …, tenantId }` on reads/updates/deletes, so a query can
 *     only ever see the current tenant's rows (relies on Prisma 5's GA
 *     `extendedWhereUnique` so even findUnique/update/delete-by-id are filtered);
 *   - stamps `tenantId` onto rows created via create/createMany/upsert.
 *
 * Fails closed: touching a tenant-scoped model with no context throws. Platform
 * scope (`ctx.platform`) bypasses all filtering for trusted cross-tenant work.
 *
 * NOTE: raw queries ($queryRaw/$executeRaw) are NOT intercepted by this hook —
 * any raw SQL against tenant data must add its own `"tenantId" = $n` filter.
 */
export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const ctx = getTenantContext();

        // Trusted cross-tenant scope: no filtering.
        if (ctx?.platform) {
          return query(args);
        }

        // Fail closed — a tenant-scoped model reached with no tenant scope is a
        // programming error (missing runWithTenant/runAsPlatform wrapper).
        if (!ctx || ctx.tenantId == null) {
          throw new Error(
            `Tenant-guard: '${model}.${operation}' ran with no tenant context. ` +
              'Wrap this code path in runWithTenant() or runAsPlatform().',
          );
        }

        const tenantId = ctx.tenantId;
        const a: Record<string, any> = (args as Record<string, any>) ?? {};

        // Inject the tenant filter. Flat-merging tenantId is compatible with both
        // ordinary filters and unique locators (extendedWhereUnique), and always
        // AND-s with any existing top-level condition.
        if (WHERE_OPS.has(operation)) {
          a.where = { ...(a.where ?? {}), tenantId };
        }

        // Stamp tenantId onto newly created rows (context tenant always wins).
        if (operation === 'create') {
          a.data = { ...(a.data ?? {}), tenantId };
        } else if (operation === 'createMany') {
          if (Array.isArray(a.data)) {
            a.data = a.data.map((d: Record<string, any>) => ({ ...d, tenantId }));
          } else if (a.data) {
            a.data = { ...a.data, tenantId };
          }
        } else if (operation === 'upsert') {
          a.create = { ...(a.create ?? {}), tenantId };
        }

        return query(a);
      },
    },
  },
});

/**
 * Raw, UNGUARDED Prisma client. Use only for platform/system work that must run
 * outside any tenant (migrations bootstrap, the tenant-provisioning service,
 * the platform console). Never expose this to a tenant request path.
 */
export const prismaUnscoped = base;

export type GuardedPrisma = typeof prisma;
