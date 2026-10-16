// ─── Backend Template Compiler ────────────────────────────────────────────────
// A template is a text or media message (image/video/document/audio) with an
// optional footer and up to ten buttons — the shape Meta's Cloud API approves
// and delivers, so the recipient gets what the builder previewed.
//
// Converts a stored MessageTemplate.payload into a Renderable used for sending.

// ── Types ─────────────────────────────────────────────────────────────────────

export type TemplateCategory =
  | 'GENERAL' | 'ONBOARDING' | 'SALES' | 'SUPPORT'
  | 'ECOMMERCE' | 'APPOINTMENTS' | 'FOLLOW_UP'
  | string

/** AUDIO covers both a recorded voice note and an uploaded audio clip. */
export type MediaType = 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO'

export interface CanonicalMedia {
  type: MediaType
  /** Storage-relative ref (see lib/media.ts), never an absolute URL. */
  url?: string
  filename?: string
  mimeType?: string
}

/**
 * A template button, in Meta's own vocabulary. Static only when authored here;
 * `example` is kept for buttons imported from Meta whose URL ends in `{{1}}` or
 * that carry a coupon code — both need a parameter at send time.
 */
export type TemplateButtonDef =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; text?: string; example: string }

/** Footer + buttons exactly as Meta approved them. */
export interface MetaExtras {
  footer?: string
  buttons?: TemplateButtonDef[]
}

export interface CanonicalTemplate {
  name: string
  category: TemplateCategory
  language: string
  media?: CanonicalMedia
  body: { text: string }
  /** Small grey line under the body. Max 60 chars, no variables. */
  footer?: { text: string }
  buttons?: TemplateButtonDef[]
  _meta?: {
    variableNames?: string[]
    previewValues?: Record<string, string>
    description?: string
    /** Snapshot of what Meta approved — written on submit and on sync. */
    meta?: MetaExtras
  }
}

export interface RenderableTemplate {
  media?: { type: MediaType; url?: string; filename?: string; mimeType?: string }
  body: string
  footer?: string
  buttons?: TemplateButtonDef[]
}

// ── Buttons ───────────────────────────────────────────────────────────────────
// Meta's rules, enforced in one place so the builder, submission and import all
// agree: ≤10 buttons, ≤2 website, ≤1 call, ≤1 copy-code, 25-char labels, and
// quick replies grouped together (Meta rejects them interleaved with links).

export const BUTTON_LIMITS = { total: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1, text: 25, footer: 60 } as const

export function normalizeButtons(raw: unknown): TemplateButtonDef[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateButtonDef[] = []
  for (const b of raw) {
    const type = String((b as any)?.type ?? '').toUpperCase()
    const text = String((b as any)?.text ?? '').trim()
    if (type === 'QUICK_REPLY' && text) out.push({ type, text })
    else if (type === 'URL' && text && (b as any).url) {
      const ex = (b as any).example
      out.push({ type, text, url: String((b as any).url).trim(), ...(ex ? { example: String(Array.isArray(ex) ? ex[0] : ex) } : {}) })
    } else if (type === 'PHONE_NUMBER' && text && ((b as any).phone_number || (b as any).phoneNumber)) {
      out.push({ type, text, phone_number: String((b as any).phone_number ?? (b as any).phoneNumber).replace(/[\s()-]/g, '') })
    } else if (type === 'COPY_CODE' && (b as any).example) {
      const ex = (b as any).example
      out.push({ type, ...(text ? { text } : {}), example: String(Array.isArray(ex) ? ex[0] : ex) })
    }
  }
  // Group: quick replies first, then call-to-actions — order inside each kept.
  return [...out.filter((b) => b.type === 'QUICK_REPLY'), ...out.filter((b) => b.type !== 'QUICK_REPLY')]
}

/** Human-readable problems with a footer/buttons set, or [] when Meta will accept it. */
export function buttonProblems(buttons: TemplateButtonDef[], footer?: string): string[] {
  const problems: string[] = []
  if (footer && footer.length > BUTTON_LIMITS.footer) problems.push(`The footer is longer than ${BUTTON_LIMITS.footer} characters.`)
  if (footer && /\{\{/.test(footer)) problems.push('The footer cannot contain personalisation like {{name}}.')
  if (buttons.length > BUTTON_LIMITS.total) problems.push(`WhatsApp allows at most ${BUTTON_LIMITS.total} buttons.`)
  const count = (t: string) => buttons.filter((b) => b.type === t).length
  if (count('URL') > BUTTON_LIMITS.URL) problems.push(`WhatsApp allows at most ${BUTTON_LIMITS.URL} website buttons.`)
  if (count('PHONE_NUMBER') > BUTTON_LIMITS.PHONE_NUMBER) problems.push('WhatsApp allows only one call button.')
  if (count('COPY_CODE') > BUTTON_LIMITS.COPY_CODE) problems.push('WhatsApp allows only one copy-code button.')
  for (const b of buttons) {
    if (b.type !== 'COPY_CODE' && b.text.length > BUTTON_LIMITS.text) problems.push(`Button "${b.text}" is longer than ${BUTTON_LIMITS.text} characters.`)
    if (b.type === 'URL' && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(b.url)) problems.push(`Button "${b.text}" needs a full web address starting with https://`)
    if (b.type === 'PHONE_NUMBER' && !/^\+?[1-9]\d{7,14}$/.test(b.phone_number.replace(/[\s()-]/g, ''))) problems.push(`Button "${b.text}" needs a phone number in international format, like +966500000000.`)
  }
  return problems
}

// ── Payload detection ─────────────────────────────────────────────────────────

export function isCanonicalPayload(payload: unknown): payload is CanonicalTemplate {
  return (
    payload != null &&
    typeof payload === 'object' &&
    typeof (payload as any).body?.text === 'string'
  )
}

export function isLegacyPayload(payload: unknown): payload is { blocks: any[]; category?: string } {
  return (
    payload != null &&
    typeof payload === 'object' &&
    Array.isArray((payload as any).blocks)
  )
}

// ── Variable interpolation ────────────────────────────────────────────────────

function interpolateNamed(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `[${k}]`)
}

function resolveText(text: string, varNames: string[], vars: Record<string, string>): string {
  let result = text
  varNames.forEach((name, i) => {
    result = result.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), vars[name] ?? `[${name}]`)
  })
  return interpolateNamed(result, vars)
}

// ── Renderable Compiler ───────────────────────────────────────────────────────

export function toRenderable(
  template: CanonicalTemplate,
  vars: Record<string, string> = {},
): RenderableTemplate {
  const varNames = template._meta?.variableNames ?? []
  const resolve = (text: string) => resolveText(text, varNames, vars)

  const renderable: RenderableTemplate = { body: resolve(template.body.text) }
  if (template.footer?.text?.trim()) renderable.footer = template.footer.text.trim()
  if (template.buttons?.length) renderable.buttons = template.buttons
  if (template.media) {
    renderable.media = {
      type: template.media.type,
      url: template.media.url,
      filename: template.media.filename,
      mimeType: template.media.mimeType,
    }
  }
  return renderable
}

// ── Variable extraction ───────────────────────────────────────────────────────

export function extractVariableNames(template: CanonicalTemplate): string[] {
  const vars = new Set<string>()
  for (const m of (template.body.text ?? '').matchAll(/\{\{(\w+)\}\}/g)) vars.add(m[1])
  return Array.from(vars)
}

// ── Legacy fold ────────────────────────────────────────────────────────────────
// Templates saved before this redesign may carry a text header — folded into the
// body so nothing is lost. Footer and buttons are first-class on the Cloud API,
// so they are kept as structure rather than flattened into text.

export function foldLegacyCanonical(raw: any): CanonicalTemplate {
  const parts: string[] = []
  const header = raw?.header

  if (header?.type === 'TEXT' && header.text?.trim()) parts.push(`*${header.text.trim()}*`)
  if (raw?.body?.text?.trim()) parts.push(raw.body.text.trim())
  const footer = typeof raw?.footer?.text === 'string' && raw.footer.text.trim() ? { text: raw.footer.text.trim() } : undefined
  const buttons = normalizeButtons(raw?.buttons)

  const media: CanonicalMedia | undefined =
    header && header.type !== 'TEXT' && header.type
      ? { type: header.type as MediaType, url: header.url, filename: header.filename, mimeType: header.mimeType }
      : raw?.media
      ? { type: raw.media.type as MediaType, url: raw.media.url, filename: raw.media.filename, mimeType: raw.media.mimeType }
      : undefined

  const canonical: CanonicalTemplate = {
    name: raw?.name ?? 'Template',
    category: raw?.category ?? 'GENERAL',
    language: raw?.language ?? 'en_US',
    body: { text: parts.join('\n\n') },
    _meta: raw?._meta,
  }
  if (media) canonical.media = media
  if (footer) canonical.footer = footer
  if (buttons.length) canonical.buttons = buttons
  return canonical
}

// ── Legacy blocks → Canonical ─────────────────────────────────────────────────

export function legacyBlocksToCanonical(
  blocks: any[],
  name: string,
  category?: string,
  language?: string,
): CanonicalTemplate {
  const textBlocks = blocks.filter(b => b.type === 'text')
  const mediaBlock = blocks.find(b => b.type === 'media')

  const titleBlock  = textBlocks.find((b: any) => b.style === 'title')
  const bodyBlocks  = textBlocks.filter((b: any) => b.style !== 'title' && b.style !== 'footer')
  const footerBlock = textBlocks.find((b: any) => b.style === 'footer')

  const parts: string[] = []
  if (titleBlock?.content) parts.push(`*${titleBlock.content}*`)
  parts.push(...bodyBlocks.map((b: any) => b.content).filter(Boolean))
  if (footerBlock?.content) parts.push(`_${footerBlock.content}_`)

  const canonical: CanonicalTemplate = {
    name,
    category: category ?? 'GENERAL',
    language: language ?? 'en_US',
    body: { text: parts.join('\n\n') || 'Hello {{name}}' },
  }

  if (mediaBlock?.url) {
    const type: MediaType = mediaBlock.mediaType === 'image' ? 'IMAGE'
      : mediaBlock.mediaType === 'video' ? 'VIDEO' : 'DOCUMENT'
    canonical.media = { type, url: mediaBlock.url }
  }

  return canonical
}
