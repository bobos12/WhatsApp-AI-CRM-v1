/**
 * Interactive Message Service
 *
 * Sends interactive messages (buttons, list, CTA).
 *
 * The structure is now passed through to the provider rather than flattened
 * here. That matters because the two transports can do genuinely different
 * things with it: Baileys must degrade to a numbered text menu (WhatsApp Web
 * cannot deliver interactive payloads), while the Cloud API renders real
 * tappable buttons and list sheets. Flattening at this layer, as the previous
 * version did, silently denied Cloud API tenants a feature they are paying for.
 *
 * `buildText` is kept and still used by the Baileys path and by previews.
 */

import { logger } from '../lib/logger';
import { providerManager } from '../providers/manager';
import type { OutboundInteractive } from '../providers/types';

// ── Baileys text builder ──────────────────────────────────────────────────────

function buildText(content: any): string {
  const lines: string[] = [];

  if (content.header?.text) lines.push(`*${content.header.text}*`);
  lines.push(content.body ?? '');
  if (content.footer) lines.push(`_${content.footer}_`);

  if (content.kind === 'interactive_buttons' && content.buttons?.length > 0) {
    lines.push('\nOptions:');
    (content.buttons as any[]).forEach((b, i) => lines.push(`${i + 1}. ${b.title}`));
    lines.push('\n_Reply with a number to choose._');
  }

  if (content.kind === 'interactive_list') {
    const allRows = (content.sections ?? []).flatMap((s: any) => s.rows ?? []);
    lines.push(`\n${content.buttonText ?? 'Options'}:`);
    allRows.forEach((r: any, i: number) => {
      const desc = r.description ? ` — ${r.description}` : '';
      lines.push(`${i + 1}. ${r.title}${desc}`);
    });
    lines.push('\n_Reply with a number to choose._');
  }

  if (content.kind === 'interactive_cta' && content.cta) {
    lines.push(`\n${content.cta.displayText}: ${content.cta.url}`);
  }

  return lines.join('\n');
}

// ── Public service ────────────────────────────────────────────────────────────

export type InteractiveKind = 'interactive_buttons' | 'interactive_list' | 'interactive_cta';

/** Normalise the loosely-typed builder payload into the provider's shape. */
function toOutbound(content: { kind: InteractiveKind; [key: string]: any }): OutboundInteractive {
  return {
    kind: content.kind,
    headerText: content.header?.text ?? undefined,
    body: String(content.body ?? ''),
    footer: content.footer ?? undefined,
    buttons: Array.isArray(content.buttons)
      ? content.buttons.map((b: any, i: number) => ({
          // Baileys builders did not always assign ids; the Cloud API requires
          // one per button because it is what comes back on a tap.
          id: String(b.id ?? `btn_${i + 1}`),
          title: String(b.title ?? ''),
        }))
      : undefined,
    buttonText: content.buttonText ?? undefined,
    sections: Array.isArray(content.sections)
      ? content.sections.map((s: any) => ({
          title: String(s.title ?? ''),
          rows: (s.rows ?? []).map((r: any, i: number) => ({
            id: String(r.id ?? `row_${i + 1}`),
            title: String(r.title ?? ''),
            description: r.description ?? undefined,
          })),
        }))
      : undefined,
    cta: content.cta ?? undefined,
  };
}

export const interactiveMessageService = {
  /**
   * Send an interactive message, letting the active provider decide how to
   * render it.
   */
  async send(
    phone: string,
    content: { kind: InteractiveKind; [key: string]: unknown },
    options?: { conversationId?: string; clientId?: string },
  ): Promise<{ messageId: string }> {
    logger.info('interactive.send', { phone, kind: content.kind });
    const result = await providerManager.sendMessage({
      phone,
      interactive: toOutbound(content as any),
      conversationId: options?.conversationId,
      clientId: options?.clientId,
    });
    logger.info('interactive.sent', { phone, kind: content.kind, messageId: result.messageId });
    return result;
  },

  /** Build the formatted plain-text representation without sending. */
  buildText(content: { kind: InteractiveKind; [key: string]: unknown }): string {
    return buildText(content);
  },
};

export default interactiveMessageService;
