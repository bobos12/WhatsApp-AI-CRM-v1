import { prisma } from '../lib/prisma';
import { getTenantId } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { logger } from '../lib/logger';
import { retryAsync } from '../lib/retry';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkAutomationRules(phone: string, messageBody: string) {
  const rules = await prisma.automationRule.findMany({
    where: { isActive: true },
  });

  for (const rule of rules) {
    let shouldFire = false;

    switch (rule.trigger) {
      case 'KEYWORD':
        if (rule.keyword && messageBody.toLowerCase().includes(rule.keyword.toLowerCase())) {
          shouldFire = true;
        }
        break;
      case 'FIRST_MESSAGE':
        const messageCount = await prisma.message.count({
          where: { conversation: { contact: { phone } }, fromMe: false },
        });
        if (messageCount === 1) {
          shouldFire = true;
        }
        break;
      case 'ANY_MESSAGE':
        shouldFire = true;
        break;
      case 'OUTSIDE_HOURS':
        const now = new Date();
        const cairoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
        const hour = cairoTime.getHours();
        if (hour < 9 || hour >= 18) {
          shouldFire = true;
        }
        break;
    }

    if (shouldFire) {
      const configuredDelay = Number(process.env.AUTOMATION_RESPONSE_DELAY_MS || 0);
      if (configuredDelay > 0) {
        await sleep(configuredDelay);
      }

      await retryAsync(
        async () => {
          await providerManager.sendMessage({ phone, text: rule.response });
        },
        {
          attempts: 3,
          delayMs: 300,
          onRetry: (error, attempt, delayMs) => {
            logger.warn('Retrying automation send', {
              phone,
              ruleId: rule.id,
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        },
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Analytics is per-tenant per-day; only record when a tenant scope is set.
      const analyticsTenantId = getTenantId();
      if (analyticsTenantId) {
        await prisma.analytics.upsert({
          where: { tenantId_date: { tenantId: analyticsTenantId, date: today } },
          update: { automationsFired: { increment: 1 } },
          create: { date: today, automationsFired: 1 },
        });
      }

      logger.info('Automation rule fired', {
        phone,
        ruleId: rule.id,
        trigger: rule.trigger,
      });

      return {
        fired: true,
        ruleId: rule.id,
      };
    }
  }

  return {
    fired: false,
    ruleId: null as string | null,
  };
}
