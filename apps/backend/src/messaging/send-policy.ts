import type { MessageKind, ProviderName } from '@crm/messaging-schema';
import { prisma } from '../lib/prisma';
import { getChannel } from '../providers/channel.service';
import { getCapabilities } from './capabilities';
import { HttpError } from '../auth/authorize';

/**
 * Whether a message may be sent right now, and if not, what would work instead.
 *
 * WhatsApp's customer service window is the single rule that most changes how
 * this product behaves on the official API: free-form content only delivers
 * within 24 hours of the customer's last inbound message. Outside it, Meta
 * rejects the send (error 131047) and only an approved template gets through.
 *
 * Every send path consults this *before* calling the provider. Discovering the
 * window from a Graph API rejection works, but it costs a round trip, produces
 * an opaque failure, and — on a broadcast — burns the run one recipient at a
 * time. Knowing locally means the UI can say "this contact went quiet 3 days
 * ago, pick a template" while the agent is still typing.
 *
 * On Baileys there is no window, so every verdict is permissive. That is not a
 * shortcut: WhatsApp Web genuinely has no such concept.
 */

export interface SendPolicyVerdict {
  provider: ProviderName;
  /** Non-template content may be sent right now. */
  freeFormAllowed: boolean;
  /** Only an approved template will deliver. */
  templateRequired: boolean;
  /** When the open window closes. Null when the provider has no window. */
  windowClosesAt: Date | null;
  /** Hours left in the window; null when not applicable. */
  hoursRemaining: number | null;
  /** Why free-form is blocked, phrased for the person in the CRM. */
  reason: string | null;
}

const PERMISSIVE = (provider: ProviderName): SendPolicyVerdict => ({
  provider,
  freeFormAllowed: true,
  templateRequired: false,
  windowClosesAt: null,
  hoursRemaining: null,
  reason: null,
});

/**
 * Evaluate the window for one conversation.
 *
 * `lastInboundAt` is maintained by the persist layer on every inbound message,
 * so this is a single indexed read rather than an aggregate over the message
 * table.
 */
export async function evaluateSendPolicy(params: {
  conversationId?: string | null;
  /** Used when there is no conversation row yet (first contact). */
  lastInboundAt?: Date | null;
}): Promise<SendPolicyVerdict> {
  const channel = await getChannel();
  const caps = getCapabilities(channel.provider);

  if (!caps.sessionWindow) return PERMISSIVE(channel.provider);

  // Callers that already hold the conversation pass `lastInboundAt` to save a
  // read; only look it up when they did not.
  let lastInboundAt = params.lastInboundAt ?? null;
  if (!lastInboundAt && params.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { lastInboundAt: true },
    });
    lastInboundAt = conv?.lastInboundAt ?? null;
  }

  const windowMs = caps.sessionWindow.hours * 60 * 60 * 1000;

  if (!lastInboundAt) {
    return {
      provider: channel.provider,
      freeFormAllowed: false,
      templateRequired: true,
      windowClosesAt: null,
      hoursRemaining: null,
      reason:
        'This contact has never messaged you on WhatsApp, so only an approved template message can be delivered.',
    };
  }

  const closesAt = new Date(lastInboundAt.getTime() + windowMs);
  const remainingMs = closesAt.getTime() - Date.now();

  if (remainingMs <= 0) {
    const hoursAgo = Math.floor(-remainingMs / 3_600_000);
    return {
      provider: channel.provider,
      freeFormAllowed: false,
      templateRequired: true,
      windowClosesAt: closesAt,
      hoursRemaining: 0,
      reason:
        `The ${caps.sessionWindow.hours}-hour reply window closed ${hoursAgo}h ago. ` +
        'Send an approved template to reopen the conversation.',
    };
  }

  return {
    provider: channel.provider,
    freeFormAllowed: true,
    templateRequired: false,
    windowClosesAt: closesAt,
    hoursRemaining: remainingMs / 3_600_000,
    reason: null,
  };
}

/**
 * Throw unless free-form content can be delivered. `kind` is honoured because a
 * template send is exactly what is allowed when the window is shut.
 */
export async function assertCanSend(params: {
  conversationId?: string | null;
  kind: MessageKind;
  lastInboundAt?: Date | null;
}): Promise<SendPolicyVerdict> {
  const verdict = await evaluateSendPolicy(params);

  // Templates are the remedy, not the thing being gated. System messages are
  // internal and never reach WhatsApp.
  if (params.kind === 'template' || params.kind === 'system') return verdict;

  if (!verdict.freeFormAllowed) {
    throw new HttpError(409, verdict.reason ?? 'This message cannot be delivered right now.', 'TEMPLATE_REQUIRED');
  }

  return verdict;
}

/**
 * Window state for many contacts at once, for broadcast audience sizing.
 *
 * Returns the phones that can still receive free-form content. A campaign author
 * needs this before they commit to a message: on Cloud API a "3,000 contact"
 * audience where 2,900 are outside the window is really a template campaign, and
 * finding that out at send time is far too late.
 */
export async function partitionByWindow(phones: string[]): Promise<{
  provider: ProviderName;
  windowApplies: boolean;
  insideWindow: string[];
  outsideWindow: string[];
}> {
  const channel = await getChannel();
  const caps = getCapabilities(channel.provider);

  if (!caps.sessionWindow || phones.length === 0) {
    return {
      provider: channel.provider,
      windowApplies: false,
      insideWindow: phones,
      outsideWindow: [],
    };
  }

  const cutoff = new Date(Date.now() - caps.sessionWindow.hours * 60 * 60 * 1000);

  const open = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      lastInboundAt: { gt: cutoff },
      contact: { phone: { in: phones } },
    },
    select: { contact: { select: { phone: true } } },
  });

  const inside = new Set(open.map((c) => c.contact?.phone).filter(Boolean) as string[]);

  return {
    provider: channel.provider,
    windowApplies: true,
    insideWindow: phones.filter((p) => inside.has(p)),
    outsideWindow: phones.filter((p) => !inside.has(p)),
  };
}
