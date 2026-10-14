import type { MessagingProvider, ProviderName, ProviderStatus, SendMessageInput } from './types';
import { MetaWhatsAppProvider } from './meta/provider';
import { getChannel } from './channel.service';
import { getTenantId } from '../lib/tenant-context';

/**
 * The messaging provider for the current tenant.
 *
 * There is exactly one transport: the official WhatsApp Business Cloud API.
 * The unofficial WhatsApp Web path (Baileys) was removed deliberately — an
 * unofficial library means a number that can be banned without appeal, a
 * protocol that breaks whenever WhatsApp changes it, and a product that cannot
 * honestly be sold as a WhatsApp integration.
 *
 * This module is kept as a thin indirection rather than having callers import
 * the provider directly, because the seam is what made removing a transport a
 * contained change — and it is the same seam a future BSP (Twilio, 360dialog)
 * would slot into.
 */

const meta = new MetaWhatsAppProvider();

/** The provider for the current tenant. */
export async function resolveProvider(): Promise<MessagingProvider> {
  return meta;
}

/** A specific provider by name. Only 'meta' exists. */
export function providerByName(_name: ProviderName): MessagingProvider {
  return meta;
}

class ProviderManager {
  async getProvider(): Promise<MessagingProvider> {
    return meta;
  }

  async activeName(): Promise<ProviderName> {
    return 'meta';
  }

  async connect(): Promise<void> {
    return meta.connect();
  }

  async disconnect(): Promise<void> {
    return meta.disconnect();
  }

  async getStatus(): Promise<ProviderStatus> {
    // A platform identity (operator console) has no tenant and therefore no
    // channel. Reporting "disconnected" keeps every status gate from throwing.
    if (!getTenantId()) {
      return { status: 'disconnected', connectedPhone: null, error: null, health: null };
    }
    return meta.getStatus();
  }

  async sendMessage(input: SendMessageInput): Promise<{ messageId: string }> {
    return meta.sendMessage(input);
  }

  async sendReaction(
    phone: string,
    messageExternalId: string,
    fromMe: boolean,
    emoji: string,
  ): Promise<void> {
    return meta.sendReaction(phone, messageExternalId, fromMe, emoji);
  }

  async getProfilePictureUrl(phone: string): Promise<string | null> {
    return meta.getProfilePictureUrl(phone);
  }

  /** The current tenant's resolved channel (credentials, health). */
  async channel() {
    return getChannel();
  }
}

export const providerManager = new ProviderManager();
