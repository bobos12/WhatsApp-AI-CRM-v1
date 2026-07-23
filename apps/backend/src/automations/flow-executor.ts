import Queue from 'bull';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { runWithTenant, runAsPlatform } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { logger } from '../lib/logger';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const flowQueue = new Queue('automation-flow-steps', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

interface FlowStepJob {
  executionId: string;
  flowId: string;
  stepIndex: number;
  phone: string;
}

let initialized = false;

export function ensureFlowWorker() {
  if (initialized) return;
  initialized = true;

  flowQueue.process(async (job) => {
    const { executionId, flowId, stepIndex, phone } = job.data as FlowStepJob;

    // Bull jobs run detached from any scope: resolve the owning tenant unguarded,
    // then run the step in that tenant's scope (fences queries + picks its socket).
    const owner = await prismaUnscoped.automationFlowExecution.findUnique({
      where: { id: executionId },
      select: { tenantId: true },
    });
    if (!owner) return;
    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      owner.tenantId ? runWithTenant(owner.tenantId, fn) : runAsPlatform(fn);

    return runScoped(async () => {
    const execution = await prisma.automationFlowExecution.findUnique({ where: { id: executionId } });
    if (!execution || execution.status !== 'RUNNING') return;

    const flow = await prisma.automationFlow.findUnique({
      where: { id: flowId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!flow || !flow.isActive) {
      await prisma.automationFlowExecution.update({
        where: { id: executionId },
        data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: 'flow_disabled' },
      });
      return;
    }

    const steps = flow.steps;
    if (stepIndex >= steps.length) {
      await prisma.automationFlowExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', currentStep: stepIndex },
      });
      return;
    }

    const step = steps[stepIndex];
    await prisma.automationFlowExecution.update({ where: { id: executionId }, data: { currentStep: stepIndex } });

    if (step.type === 'SEND_MESSAGE' && step.message) {
      try {
        await providerManager.sendMessage({ phone, text: step.message });
      } catch (err) {
        logger.warn('flow.step.send_failed', { executionId, stepIndex, error: String(err) });
      }
    }

    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      const nextStep = steps[nextIndex];
      const delayMs = step.type === 'WAIT' ? (step.delayMs ?? 0) : (nextStep.type === 'WAIT' ? (nextStep.delayMs ?? 0) : 0);
      const actualNextIndex = nextStep.type === 'WAIT' ? nextIndex + 1 : nextIndex;

      if (actualNextIndex < steps.length) {
        await flowQueue.add(
          { executionId, flowId, stepIndex: actualNextIndex, phone },
          { delay: delayMs },
        );
      } else {
        await prisma.automationFlowExecution.update({
          where: { id: executionId },
          data: { status: 'COMPLETED', currentStep: actualNextIndex },
        });
      }
    } else {
      await prisma.automationFlowExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', currentStep: nextIndex },
      });
    }
    });
  });
}

/** Start a flow execution for a given phone number */
export async function startFlowExecution(flowId: string, phone: string): Promise<void> {
  const flow = await prisma.automationFlow.findUnique({
    where: { id: flowId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!flow || !flow.isActive || flow.steps.length === 0) return;

  // Stop any existing RUNNING executions for this phone+flow
  await prisma.automationFlowExecution.updateMany({
    where: { flowId, phone, status: 'RUNNING' },
    data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: 'restarted' },
  });

  const execution = await prisma.automationFlowExecution.create({
    data: { flowId, phone, currentStep: 0, status: 'RUNNING' },
  });

  const firstStep = flow.steps[0];
  // If first step is a WAIT, delay before first real step
  if (firstStep.type === 'WAIT') {
    const delayMs = firstStep.delayMs ?? 0;
    const nextIndex = 1;
    if (nextIndex < flow.steps.length) {
      await flowQueue.add({ executionId: execution.id, flowId, stepIndex: nextIndex, phone }, { delay: delayMs });
    } else {
      await prisma.automationFlowExecution.update({
        where: { id: execution.id },
        data: { status: 'COMPLETED' },
      });
    }
  } else {
    await flowQueue.add({ executionId: execution.id, flowId, stepIndex: 0, phone });
  }
}

/** Stop all active flow executions for a phone — call when human message received */
export async function stopFlowExecutionsOnReply(phone: string): Promise<void> {
  const activeFlows = await prisma.automationFlow.findMany({
    where: { isActive: true, stopOnReply: true },
    select: { id: true },
  });
  if (!activeFlows.length) return;

  await prisma.automationFlowExecution.updateMany({
    where: { phone, status: 'RUNNING', flowId: { in: activeFlows.map((f) => f.id) } },
    data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: 'human_reply' },
  });
}

/** Check flows matching a trigger and start them */
export async function triggerFlows(
  phone: string,
  messageBody: string,
  trigger: 'KEYWORD' | 'FIRST_MESSAGE' | 'ANY_MESSAGE' | 'OUTSIDE_HOURS',
  teamId?: string,
): Promise<void> {
  const flows = await prisma.automationFlow.findMany({
    where: {
      isActive: true,
      trigger: trigger as any,
      ...(teamId ? { teamId } : {}),
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  });

  for (const flow of flows) {
    let shouldFire = false;
    switch (flow.trigger) {
      case 'KEYWORD':
        if (flow.keyword && messageBody.toLowerCase().includes(flow.keyword.toLowerCase())) shouldFire = true;
        break;
      case 'FIRST_MESSAGE':
      case 'ANY_MESSAGE':
      case 'OUTSIDE_HOURS':
        shouldFire = true;
        break;
    }
    if (shouldFire) {
      await startFlowExecution(flow.id, phone);
    }
  }
}
