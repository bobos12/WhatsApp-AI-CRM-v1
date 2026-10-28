import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../../auth/auth.middleware';
import { isManager } from '../../auth/authorize';
import { TasksService } from '../../tasks/tasks.service';
import { emitRealtime } from '../../realtime/socket';
import { notifyTaskAssigned } from '../../notifications/events';

const router = Router();

router.use(authMiddleware);

// GET /api/tasks — admin sees team tasks, agents see only their own
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAdmin = isManager(user?.role);

    const tasks = await TasksService.getTasks({
      teamId: user?.teamId ?? undefined,
      assigneeId: isAdmin ? undefined : user?.id,
      isAdmin,
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/tasks/conversation/:id — tasks linked to a conversation
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const tasks = await TasksService.getTasksByConversation(req.params.conversationId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/tasks — admin can assign to anyone; agents can create for themselves
router.post('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAdmin = isManager(user?.role);

    const assigneeId = isAdmin ? (req.body.assigneeId || undefined) : user.id;

    const task = await TasksService.createTask({
      ...req.body,
      assigneeId,
      teamId: user?.teamId ?? undefined,
    });

    emitRealtime('task:created', task, user?.teamId);
    if (task?.assigneeId) void notifyTaskAssigned({ task, assigneeId: task.assigneeId, actorId: user.id });
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// PUT /api/tasks/:id — admin can update anything; agents can only update status
router.put('/:id', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAdmin = isManager(user?.role);

    const updateData = isAdmin
      ? { ...req.body, teamId: user?.teamId ?? undefined }
      : { status: req.body.status };

    const task = await TasksService.updateTask(req.params.id, updateData, (assigneeId, updated) =>
      notifyTaskAssigned({ task: updated, assigneeId, actorId: user.id }),
    );
    emitRealtime('task:updated', task, user?.teamId);
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// DELETE /api/tasks/:id — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await TasksService.deleteTask(req.params.id);
    emitRealtime('task:deleted', { id: req.params.id }, user?.teamId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
