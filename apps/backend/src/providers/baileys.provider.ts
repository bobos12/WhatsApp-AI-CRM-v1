import {
  connectToWhatsApp,
  disconnectWhatsApp,
  getSock,
  getWaStatus,
  getCurrentQR,
  getLastError,
  getWhatsAppProfilePictureUrl,
} from '../whatsapp/client';
import { sendMessage as baileysSend } from '../whatsapp/sender';
import { normalizePhone, normalizeRecipient, parseWhatsAppJid } from '../lib/phone';
import type { MessagingProvider, ProviderName, ProviderStatus, SendMessageInput } from './types';

export class BaileysProvider implements MessagingProvider {
  readonly name: ProviderName = 'baileys';

  async connect(): Promise<void> {
    await connectToWhatsApp();
  }

  async disconnect(): Promise<void> {
    await disconnectWhatsApp();
  }

  getStatus(): ProviderStatus {
    const sock = getSock();
    const userId = sock?.user?.id as string | undefined;
    const numberPart = userId?.split('@')[0]?.split(':')[0];
    const connectedPhone = numberPart
      ? parseWhatsAppJid(numberPart) || normalizePhone(numberPart) || null
      : null;

    return {
      status: getWaStatus(),
      qr: getCurrentQR(),
      connectedPhone,
      error: getLastError(),
    };
  }

  async sendMessage(input: SendMessageInput): Promise<{ messageId: string }> {
    const media = input.media
      ? {
          mediaBuffer: input.media.buffer,
          mediaMimeType: input.media.mimetype,
          mediaFileName: input.media.filename,
          mediaCaption: input.media.caption,
          mediaDuration: input.media.duration,
          mediaIsVoiceNote: input.media.isVoiceNote,
          mediaUrl: input.media.url,
        }
      : undefined;

    const replyTo = input.replyTo
      ? { replyToId: input.replyTo.id, replyToBody: input.replyTo.body }
      : undefined;

    const msg = await baileysSend(input.phone, input.text ?? '', media, replyTo, input.clientId, input.conversationId);
    return { messageId: msg.id };
  }

  async sendReaction(
    phone: string,
    messageExternalId: string,
    fromMe: boolean,
    emoji: string,
  ): Promise<void> {
    const sock = getSock();
    if (!sock || getWaStatus() !== 'connected') throw new Error('WhatsApp is not connected');
    const jid = normalizeRecipient(phone);
    if (!jid) throw new Error('Invalid recipient');
    await sock.sendMessage(jid, {
      react: {
        text: emoji,
        key: { remoteJid: jid, fromMe, id: messageExternalId },
      },
    } as any);
  }

  async getProfilePictureUrl(phone: string): Promise<string | null> {
    return getWhatsAppProfilePictureUrl(phone);
  }
}
