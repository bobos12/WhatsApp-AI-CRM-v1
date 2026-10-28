import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { forEachActiveTenant } from '../tenants/for-each-tenant';
import { notificationsService } from './notifications.service';

/**
 * Deadline reminders for assigned, unfinished tasks: once when a task is due
 * tomorrow, once on the day, once when it goes overdue. Each phase is one
 * notification per task (dedupeKey "task-due:<id>:<phase>", which the push
 * dispatcher also reads to build the "4 tasks need your attention" digest).
 *
 * Only created during the working day in NOTIFY_TIMEZONE so nobody's phone
 * buzzes at 3am; a phase missed overnight is picked up the next morning.
 */

const INTERVAL_MS = 10 * 60 * 1000;
const OVERDUE_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const QUIET_BEFORE_HOUR = 8;
const QUIET_FROM_HOUR = 22;

type Phase = 'overdue' | 'today' | 'tomorrow';

const TIME_ZONE = process.env.NOTIFY_TIMEZONE?.trim() || 'Asia/Riyadh';

function localParts(d: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function phaseOf(due: Date, now: Date): Phase | null {
  if (due <= now) return 'overdue';
  const today = localParts(now).day;
  const tomorrow = localParts(new Date(now.getTime() + 24 * 60 * 60 * 1000)).day;
  const dueDay = localParts(due).day;
  if (dueDay === today) return 'today';
  if (dueDay === tomorrow) return 'tomorrow';
  return null;
}

const TEXT: Record<Phase, { en: string; ar: string }> = {
  overdue: { en: 'Task overdue', ar: 'مهمة متأخرة' },
  today: { en: 'Task due today', ar: 'مهمة مستحقة اليوم' },
  tomorrow: { en: 'Task due tomorrow', ar: 'مهمة مستحقة غدًا' },
};

async function sweepTenant(tenantId: string, now: Date): Promise<void> {
  // Task is read through raw SQL elsewhere too, so fence the tenant explicitly.
  const tasks = await prisma.$queryRawUnsafe<
    { id: string; title: string; dueDate: Date; assigneeId: string; teamId: string | null; conversationId: string | null; contactId: string | null }[]
  >(
    `SELECT id, title, "dueDate", "assigneeId", "teamId", "conversationId", "contactId"
       FROM "Task"
      WHERE "tenantId" = $1 AND "assigneeId" IS NOT NULL AND status::text <> 'DONE'
        AND "dueDate" > $2 AND "dueDate" < $3`,
    tenantId,
    new Date(now.getTime() - OVERDUE_LOOKBACK_MS),
    new Date(now.getTime() + 48 * 60 * 60 * 1000),
  );
  if (tasks.length === 0) return;

  const due = tasks
    .map((t) => ({ task: t, phase: phaseOf(new Date(t.dueDate), now) }))
    .filter((x): x is { task: (typeof tasks)[number]; phase: Phase } => x.phase !== null)
    .map((x) => ({ ...x, key: `task-due:${x.task.id}:${x.phase}` }));
  if (due.length === 0) return;

  // One read to skip what was already sent, instead of a failed insert per task per tick.
  const existing = await prisma.notification.findMany({
    where: { dedupeKey: { in: due.map((d) => d.key) } },
    select: { dedupeKey: true, recipientId: true },
  });
  const done = new Set(existing.map((e) => `${e.recipientId}|${e.dedupeKey}`));

  for (const { task, phase, key } of due) {
    if (done.has(`${task.assigneeId}|${key}`)) continue;
    const title = task.title.trim();
    await notificationsService.notify({
      type: 'TASK_DUE',
      recipients: [task.assigneeId],
      title: TEXT[phase],
      body: { en: title, ar: title },
      url: '/tasks',
      priority: phase === 'overdue' ? 'HIGH' : 'NORMAL',
      contactId: task.contactId,
      conversationId: task.conversationId,
      teamId: task.teamId,
      dedupeKey: key,
    });
  }
}

export function startDeadlineReminders(): NodeJS.Timeout {
  const tick = async () => {
    const now = new Date();
    const { hour } = localParts(now);
    if (hour < QUIET_BEFORE_HOUR || hour >= QUIET_FROM_HOUR) return;
    try {
      await forEachActiveTenant((tenantId) => sweepTenant(tenantId, now));
    } catch (err) {
      logger.warn('deadlines.sweep_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  setTimeout(() => void tick(), 30_000).unref();
  const t = setInterval(() => void tick(), INTERVAL_MS);
  t.unref();
  return t;
}
