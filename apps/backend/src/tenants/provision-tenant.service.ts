/**
 * Tenant provisioning + first-boot migration.
 *
 * This is the single code path for creating a business ("tenant") in the shared
 * deployment. It is used by:
 *   - boot: `bootstrapTenancy()` folds any pre-multitenant data into a default
 *     tenant (so the existing business keeps running as "tenant #1") and seeds
 *     the platform owner + the env-configured owner.
 *   - the platform console / CLI (Phase 6): `provisionTenant()` mints a brand-new
 *     tenant + its owner login.
 *
 * Everything here runs UNSCOPED (prismaUnscoped) — it is platform-level work that
 * deliberately reaches across tenants — so every write sets `tenantId` explicitly.
 */
import bcrypt from 'bcryptjs';
import { prismaUnscoped } from '../lib/prisma';
import { logger } from '../lib/logger';
import { aiConfigService } from '../services/ai-config.service';

const DEFAULT_TENANT_SLUG = 'default';

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'tenant';
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  // Slugs are globally unique; append a counter until free.
  while (await prismaUnscoped.tenant.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

export interface ProvisionTenantInput {
  name: string;
  slug?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  ownerName?: string;
}

export interface ProvisionTenantResult {
  tenant: { id: string; name: string; slug: string };
  owner: { id: string; email: string } | null;
}

/**
 * Create a brand-new tenant and (optionally) its first owner login + default team.
 * The owner is a tenant-scoped SUPER_ADMIN — full access to their own business,
 * nothing outside it.
 */
export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const slug = input.slug ? slugify(input.slug) : await uniqueSlug(input.name);
  const tenant = await prismaUnscoped.tenant.create({
    data: { name: input.name, slug },
    select: { id: true, name: true, slug: true },
  });

  let owner: { id: string; email: string } | null = null;
  const email = input.ownerEmail?.trim().toLowerCase();
  if (email && input.ownerPassword) {
    const hashed = await bcrypt.hash(input.ownerPassword, 12);
    const created = await prismaUnscoped.user.create({
      data: {
        name: input.ownerName?.trim() || input.name,
        email,
        password: hashed,
        role: 'SUPER_ADMIN',
        tenantId: tenant.id,
      },
      select: { id: true, email: true },
    });
    const team = await prismaUnscoped.team.create({
      data: { name: input.name, ownerId: created.id, tenantId: tenant.id },
      select: { id: true },
    });
    await prismaUnscoped.user.update({ where: { id: created.id }, data: { teamId: team.id } });
    owner = created;
  }

  logger.info('tenant.provisioned', { tenantId: tenant.id, slug, hasOwner: Boolean(owner) });
  return { tenant, owner };
}

/** Get the default tenant (the home of pre-multitenant data), creating it if absent. */
export async function getOrCreateDefaultTenant(name = 'Default'): Promise<{ id: string }> {
  const existing = await prismaUnscoped.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
  if (existing) return existing;
  return prismaUnscoped.tenant.create({
    data: { name, slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
}

/**
 * Fold every pre-multitenant row (tenantId = null) into the default tenant, so the
 * existing single business keeps working unchanged as the first tenant. Idempotent:
 * once swept, there are no null rows left, so later boots are no-ops.
 *
 * Deliberately NOT swept:
 *   - platform identities (PLATFORM_OWNER role + the dev superuser email) — they
 *     stay tenantId=null so they keep their cross-tenant scope.
 *   - the shared chatbot-credentials Setting row — stays platform-level (null).
 */
export async function backfillLegacyRowsIntoDefault(tenantId: string): Promise<void> {
  // Users: every existing user (including the developer super-account, who runs
  // this business AND operates the platform) joins the default tenant. Only a
  // PURE platform operator (PLATFORM_OWNER, no business of their own) stays
  // tenant-less so they land on the operator console instead of a business.
  await prismaUnscoped.user.updateMany({
    where: { tenantId: null, role: { not: 'PLATFORM_OWNER' } },
    data: { tenantId },
  });

  // Every other tenant-scoped table: sweep null → default. (Setting is intentionally omitted.)
  await prismaUnscoped.team.updateMany({ where: { tenantId: null }, data: { tenantId } });

  // WhatsAppSession.tenantId is @unique (one connection per tenant), so we can't
  // bulk-assign several legacy rows to the same tenant. Attach only the most
  // recently used session to the default tenant; leave any stale extras unattached
  // (multiple null rows are allowed and reconnectAll ignores them).
  const existingSession = await prismaUnscoped.whatsAppSession.findFirst({
    where: { tenantId },
    select: { id: true },
  });
  if (!existingSession) {
    const primarySession = await prismaUnscoped.whatsAppSession.findFirst({
      where: { tenantId: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (primarySession) {
      await prismaUnscoped.whatsAppSession.update({ where: { id: primarySession.id }, data: { tenantId } });
    }
  }

  await prismaUnscoped.contact.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.customFieldDefinition.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.tag.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.conversation.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.message.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.messageReaction.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.internalNote.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.automationRule.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.automationFlow.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.automationFlowExecution.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.broadcast.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.broadcastRecipient.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.analytics.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.auditLog.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.savedReply.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.deal.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.messageTemplate.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.task.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.leadQualification.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.leadStatusEvent.updateMany({ where: { tenantId: null }, data: { tenantId } });
  await prismaUnscoped.notification.updateMany({ where: { tenantId: null }, data: { tenantId } });
}

/**
 * First-boot tenancy bootstrap. Creates the default tenant, migrates any legacy
 * data into it, and seeds the env-configured business owner (create-only) inside
 * that tenant. Safe to run on every boot.
 */
export async function bootstrapDefaultTenant(): Promise<void> {
  try {
    const ownerName = process.env.OWNER_NAME?.trim() || 'Default';
    const tenant = await getOrCreateDefaultTenant(ownerName);
    await backfillLegacyRowsIntoDefault(tenant.id);
    // Fold the legacy single-tenant AI/bot config into the Default tenant so its
    // bot persona is preserved; new tenants start from defaults.
    aiConfigService.seedFromLegacy(tenant.id);

    // Seed the env-configured owner (create-only) inside the default tenant.
    const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const password = process.env.OWNER_PASSWORD;
    if (email && password) {
      const existing = await prismaUnscoped.user.findUnique({ where: { email }, select: { id: true } });
      if (!existing) {
        const hashed = await bcrypt.hash(password, 12);
        const owner = await prismaUnscoped.user.create({
          data: {
            name: process.env.OWNER_NAME?.trim() || 'Owner',
            email,
            password: hashed,
            role: 'SUPER_ADMIN',
            tenantId: tenant.id,
          },
          select: { id: true },
        });
        // Attach to a team if the tenant has none yet.
        const team =
          (await prismaUnscoped.team.findFirst({ where: { tenantId: tenant.id }, select: { id: true } })) ??
          (await prismaUnscoped.team.create({
            data: { name: ownerName, ownerId: owner.id, tenantId: tenant.id },
            select: { id: true },
          }));
        await prismaUnscoped.user.update({ where: { id: owner.id }, data: { teamId: team.id } });
        logger.info('tenant.default_owner_created', { email });
      }
    }
  } catch (err) {
    logger.error('tenant.bootstrap_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
