import { prisma } from '../lib/prisma';
import { getTenantId } from '../lib/tenant-context';
import crypto from 'crypto';

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

function mapTaskRow(row: any) {
  if (!row) return row;
  const { contact__id, contact__name, contact__phone, assignee__id, assignee__name, assignee__email, ...task } = row;
  return {
    ...task,
    contact: contact__id ? { id: contact__id, name: contact__name, phone: contact__phone } : null,
    assignee: assignee__id ? { id: assignee__id, name: assignee__name, email: assignee__email } : null,
  };
}

async function ensureTasksTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Task" (
      id TEXT PRIMARY KEY,
      "tenantId" TEXT NULL,
      "teamId" TEXT NULL,
      "contactId" TEXT NULL,
      "conversationId" TEXT NULL,
      title TEXT NOT NULL,
      description TEXT NULL,
      "dueDate" TIMESTAMP(3) NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      "assigneeId" TEXT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Add new columns to existing deployments
  await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIUM'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "conversationId" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "tenantId" TEXT NULL`);
}

/**
 * The current tenant id for a task query. This service uses raw SQL, so the
 * Prisma tenant-guard does NOT apply — every query below must filter on this
 * explicitly, or a manager could reach another tenant's tasks by id.
 */
function currentTenantId(): string | null {
  return getTenantId();
}

const SELECT_TASK = `
  SELECT
    t.*,
    c.id   AS "contact__id",
    c.name AS "contact__name",
    c.phone AS "contact__phone",
    u.id   AS "assignee__id",
    u.name AS "assignee__name",
    u.email AS "assignee__email"
  FROM "Task" t
  LEFT JOIN "Contact" c ON c.id = t."contactId"
  LEFT JOIN "User" u ON u.id = t."assigneeId"
`;

export class TasksService {
  static async getTasks(opts: { teamId?: string; assigneeId?: string; isAdmin?: boolean }) {
    await ensureTasksTable();
    const { teamId, assigneeId, isAdmin } = opts;

    // Always fence to the current tenant first; team/assignee narrow within it.
    const conds: string[] = [`t."tenantId" = $1`];
    const params: any[] = [currentTenantId()];

    if (isAdmin) {
      if (teamId) {
        conds.push(`t."teamId" = $${params.length + 1}`);
        params.push(teamId);
      }
    } else if (assigneeId) {
      conds.push(`t."assigneeId" = $${params.length + 1}`);
      params.push(assigneeId);
    } else {
      return [];
    }

    const query = `${SELECT_TASK} WHERE ${conds.join(' AND ')} ORDER BY t.status ASC, t."dueDate" ASC NULLS LAST, t."createdAt" DESC`;
    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params);
    return rows.map(mapTaskRow);
  }

  static async createTask(data: {
    title: string;
    description?: string;
    dueDate?: Date;
    contactId?: string;
    conversationId?: string;
    assigneeId?: string;
    teamId?: string;
    priority?: TaskPriority;
  }) {
    await ensureTasksTable();
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (id, "tenantId", "teamId", "contactId", "conversationId", title, description, "dueDate", status, priority, "assigneeId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      currentTenantId(),
      data.teamId ?? null,
      data.contactId ?? null,
      data.conversationId ?? null,
      data.title,
      data.description ?? null,
      data.dueDate ?? null,
      data.priority ?? 'MEDIUM',
      data.assigneeId ?? null,
    );
    const [task] = await prisma.$queryRawUnsafe<any[]>(`${SELECT_TASK} WHERE t.id = $1`, id);
    return mapTaskRow(task);
  }

  static async updateTask(
    id: string,
    data: {
      title?: string;
      description?: string;
      dueDate?: Date | null;
      contactId?: string | null;
      conversationId?: string | null;
      assigneeId?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      teamId?: string;
    },
  ) {
    await ensureTasksTable();
    const tenantId = currentTenantId();
    // Always fence to the tenant; optionally also to the caller's team.
    const existing = data.teamId
      ? await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Task" WHERE id = $1 AND "tenantId" = $2 AND "teamId" = $3`, id, tenantId, data.teamId)
      : await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Task" WHERE id = $1 AND "tenantId" = $2`, id, tenantId);
    if (!existing.length) throw new Error('Task not found');

    await prisma.$executeRawUnsafe(
      `UPDATE "Task"
       SET title          = COALESCE($3, title),
           description    = COALESCE($4, description),
           "dueDate"      = COALESCE($5, "dueDate"),
           "contactId"    = COALESCE($6, "contactId"),
           "assigneeId"   = COALESCE($7, "assigneeId"),
           status         = COALESCE($8, status),
           priority       = COALESCE($9, priority),
           "conversationId" = COALESCE($10, "conversationId"),
           "updatedAt"    = CURRENT_TIMESTAMP
       WHERE id = $1 AND "tenantId" = $2`,
      id,
      tenantId,
      data.title ?? null,
      data.description ?? null,
      data.dueDate ?? null,
      data.contactId ?? null,
      data.assigneeId ?? null,
      data.status ?? null,
      data.priority ?? null,
      data.conversationId ?? null,
    );
    const [task] = await prisma.$queryRawUnsafe<any[]>(`${SELECT_TASK} WHERE t.id = $1 AND t."tenantId" = $2`, id, tenantId);
    return mapTaskRow(task);
  }

  static async deleteTask(id: string, teamId?: string) {
    await ensureTasksTable();
    const tenantId = currentTenantId();
    const count = teamId
      ? await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE id = $1 AND "tenantId" = $2 AND "teamId" = $3`, id, tenantId, teamId)
      : await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE id = $1 AND "tenantId" = $2`, id, tenantId);
    if (!count) throw new Error('Task not found');
    return { success: true };
  }

  static async getTasksByConversation(conversationId: string) {
    await ensureTasksTable();
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `${SELECT_TASK} WHERE t."conversationId" = $1 AND t."tenantId" = $2 ORDER BY t."createdAt" DESC`,
      conversationId,
      currentTenantId(),
    );
    return rows.map(mapTaskRow);
  }
}
