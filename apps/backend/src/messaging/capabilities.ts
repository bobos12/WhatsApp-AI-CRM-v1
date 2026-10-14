import type { ProviderCapabilities, ProviderName } from '@crm/messaging-schema';

// ── Meta WhatsApp Business Cloud API ─────────────────────────────────────────
// The official transport. Limits below are Meta's published constraints, not
// guesses — exceeding them is a 400 from the Graph API, so the validator uses
// these to fail in the builder rather than at send time.
//
// The defining difference from Baileys is `sessionWindow`: outside 24h since the
// customer's last inbound message, Meta refuses free-form content and only an
// approved template will deliver. Everything about broadcasts follows from that.

export const CLOUD_API_CAPABILITIES: ProviderCapabilities = {
  kinds: {
    text:                     { inbound: true,  outbound: true  },
    media:                    { inbound: true,  outbound: true  },
    template:                 { inbound: false, outbound: true,  notes: 'Must be approved by Meta before it can be sent' },
    interactive_buttons:      { inbound: true,  outbound: true  },
    interactive_list:         { inbound: true,  outbound: true  },
    interactive_cta:          { inbound: false, outbound: true  },
    // Meta supports catalog messages, but they need a Commerce catalog bound to
    // the WABA and a compile path this codebase does not have yet. Declared
    // unsupported so the builder never offers something that would 400.
    interactive_product:      { inbound: false, outbound: false, notes: 'Requires a connected Meta Commerce catalog — not implemented' },
    interactive_product_list: { inbound: false, outbound: false, notes: 'Requires a connected Meta Commerce catalog — not implemented' },
    location:                 { inbound: true,  outbound: true  },
    contact_card:             { inbound: true,  outbound: true  },
    order:                    { inbound: true,  outbound: false },
    system:                   { inbound: true,  outbound: false },
    unknown:                  { inbound: true,  outbound: false },
  },

  buttonLimits: {
    quickReplyMax:      3,
    quickReplyTitleMax: 20,
    // An interactive `cta_url` message carries exactly one button — unlike
    // template URL buttons, of which there may be two.
    ctaMax:             1,
  },

  listLimits: {
    sectionsMax:       10,
    rowsPerSectionMax: 10,
    rowTitleMax:       24,
  },

  // Meta enforces these per-type; note image is 5 MB, well below Baileys' 16.
  mediaLimits: {
    image:    { sizeMaxMb: 5,   mimeWhitelist: ['image/jpeg', 'image/png'] },
    video:    { sizeMaxMb: 16,  mimeWhitelist: ['video/mp4', 'video/3gp'] },
    audio:    { sizeMaxMb: 16,  mimeWhitelist: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'] },
    voice:    { sizeMaxMb: 16,  mimeWhitelist: ['audio/ogg'] },
    document: { sizeMaxMb: 100, mimeWhitelist: [] },
    sticker:  { sizeMaxMb: 0.5, mimeWhitelist: ['image/webp'] },
  },

  /**
   * Meta's customer service window. Free-form outbound content is permitted only
   * within 24h of the customer's last inbound message; outside it, the send is
   * rejected with error 131047 and a template is the only way through.
   */
  sessionWindow: { hours: 24 },

  templates: { supported: true, requiresApproval: true },
  reactions: { supported: true },

  defaultMode: 'cloud_api',
};

// ── Capability registry ───────────────────────────────────────────────────────

const REGISTRY: Partial<Record<ProviderName, ProviderCapabilities>> = {
  meta: CLOUD_API_CAPABILITIES,
};

/**
 * Capabilities for a transport.
 *
 * Only the official Cloud API is implemented. The lookup is retained rather than
 * inlined because it is the seam a future BSP (Twilio, 360dialog) would use, and
 * because the validator reads capabilities per message rather than assuming them.
 */
export function getCapabilities(_provider: ProviderName): ProviderCapabilities {
  return CLOUD_API_CAPABILITIES;
}
