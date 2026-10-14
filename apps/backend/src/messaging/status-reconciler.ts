import { MsgStatus } from '@prisma/client';
import type { MessageStatus } from '@crm/messaging-schema';

// ── Meta Cloud API ────────────────────────────────────────────────────────────
// Webhook statuses come as lowercase strings from the Meta API.

const META_STRING_TO_MSG_STATUS: Record<string, MessageStatus> = {
  sent:      'server_confirmed', // Meta "sent" = server confirmed receipt
  delivered: 'delivered',
  read:      'read',
  failed:    'failed',
};

const META_STRING_TO_PRISMA: Record<string, MsgStatus> = {
  sent:      MsgStatus.SERVER_CONFIRMED,
  delivered: MsgStatus.DELIVERED,
  read:      MsgStatus.READ,
  failed:    MsgStatus.FAILED,
};

export function reconcileMetaStatus(webhookStatus: string): MessageStatus {
  return META_STRING_TO_MSG_STATUS[webhookStatus.toLowerCase()] ?? 'failed';
}

export function reconcileMetaStatusToPrisma(webhookStatus: string): MsgStatus | null {
  return META_STRING_TO_PRISMA[webhookStatus.toLowerCase()] ?? null;
}
