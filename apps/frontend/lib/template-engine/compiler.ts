import {
  BUTTON_LIMITS,
  type CanonicalTemplate,
  type TemplateCategory,
  type RenderableTemplate,
  type MediaType,
  type TemplateButton,
  type ButtonType,
} from './schema'

// ── Variable interpolation ────────────────────────────────────────────────────

function interpolateNamed(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `[${k}]`)
}

function interpolatePositional(text: string, varNames: string[], vars: Record<string, string>): string {
  let result = text
  varNames.forEach((name, i) => {
    result = result.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), vars[name] ?? `[${name}]`)
  })
  return interpolateNamed(result, vars)
}

function resolveText(text: string, varNames: string[], vars: Record<string, string>): string {
  return interpolatePositional(text, varNames, vars)
}

// ── Renderable Compiler ───────────────────────────────────────────────────────
// Output used by the preview panel. The recipient receives exactly this — a
// media attachment (if any) plus the message text as caption/body.

export function toRenderable(
  template: CanonicalTemplate,
  vars: Record<string, string> = {},
): RenderableTemplate {
  const varNames = template._meta?.variableNames ?? []
  const resolve = (text: string) => resolveText(text, varNames, vars)

  const renderable: RenderableTemplate = {
    body: resolve(template.body.text),
  }
  if (template.footer?.text?.trim()) renderable.footer = template.footer.text.trim()
  if (template.buttons?.length) renderable.buttons = template.buttons

  if (template.media) {
    renderable.media = {
      type: template.media.type,
      url: template.media.url,
      filename: template.media.filename,
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

// ── Derive template type for DB ────────────────────────────────────────────────

export function deriveTemplateType(template: CanonicalTemplate): 'TEXT' | 'MEDIA' {
  return template.media ? 'MEDIA' : 'TEXT'
}

// ── Buttons ────────────────────────────────────────────────────────────────────

/** Keep only well-formed buttons, quick replies grouped first (Meta's rule). */
export function normalizeButtons(raw: unknown): TemplateButton[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateButton[] = []
  for (const b of raw as any[]) {
    const type = String(b?.type ?? '').toUpperCase()
    const text = String(b?.text ?? '')
    if (type === 'QUICK_REPLY') out.push({ type, text })
    else if (type === 'URL') out.push({ type, text, url: String(b.url ?? ''), ...(b.example ? { example: String(Array.isArray(b.example) ? b.example[0] : b.example) } : {}) })
    else if (type === 'PHONE_NUMBER') out.push({ type, text, phone_number: String(b.phone_number ?? b.phoneNumber ?? '') })
    else if (type === 'COPY_CODE' && b.example) out.push({ type, ...(text ? { text } : {}), example: String(Array.isArray(b.example) ? b.example[0] : b.example) })
  }
  return [...out.filter((b) => b.type === 'QUICK_REPLY'), ...out.filter((b) => b.type !== 'QUICK_REPLY')]
}

export type ButtonIssue = 'textRequired' | 'textTooLong' | 'urlInvalid' | 'phoneInvalid'

/** What is wrong with one button, if anything — keyed for translated messages. */
export function buttonIssue(b: TemplateButton): ButtonIssue | null {
  if (b.type === 'COPY_CODE') return null
  if (!b.text.trim()) return 'textRequired'
  if (b.text.trim().length > BUTTON_LIMITS.text) return 'textTooLong'
  if (b.type === 'URL' && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(b.url.trim())) return 'urlInvalid'
  if (b.type === 'PHONE_NUMBER' && !/^\+?[1-9]\d{7,14}$/.test(b.phone_number.replace(/[\s()-]/g, ''))) return 'phoneInvalid'
  return null
}

/**
 * Footer + buttons a stored template actually sends with. Meta's approved
 * snapshot wins over the editable payload — mirrors backend `approvedExtras`,
 * so previews never promise a button the customer won't get.
 */
export function templateExtras(payload: any): { footer?: string; buttons?: TemplateButton[] } {
  const snap = payload?._meta?.meta
  const src = snap && typeof snap === 'object'
    ? { footer: snap.footer as string | undefined, buttons: snap.buttons }
    : { footer: payload?.footer?.text as string | undefined, buttons: payload?.buttons }
  const buttons = normalizeButtons(src.buttons)
  const footer = typeof src.footer === 'string' ? src.footer.trim() : ''
  return { ...(footer ? { footer } : {}), ...(buttons.length ? { buttons } : {}) }
}

/** How many more buttons of this type WhatsApp allows. */
export function remainingFor(buttons: TemplateButton[], type: ButtonType): number {
  const total = BUTTON_LIMITS.total - buttons.length
  if (type === 'QUICK_REPLY') return total
  const cap = BUTTON_LIMITS[type]
  return Math.max(0, Math.min(total, cap - buttons.filter((b) => b.type === type).length))
}

// ── Legacy fold ────────────────────────────────────────────────────────────────
// Older templates stored a text header — folded into the body so nothing the
// user wrote is lost. Footer and buttons are first-class on the Cloud API, so
// they are kept as structure rather than flattened into text.

export function foldLegacyCanonical(raw: any, fallback: {
  name: string; category?: string; language?: string;
}): CanonicalTemplate {
  const parts: string[] = []

  const header = raw?.header
  if (header?.type === 'TEXT' && header.text?.trim()) {
    parts.push(`*${header.text.trim()}*`)
  }

  if (raw?.body?.text?.trim()) parts.push(raw.body.text.trim())
  const footer = typeof raw?.footer?.text === 'string' && raw.footer.text.trim() ? { text: raw.footer.text.trim() } : undefined
  const buttons = normalizeButtons(raw?.buttons)

  const media = header && header.type !== 'TEXT' && (header.url || header.type)
    ? { type: header.type as MediaType, url: header.url, filename: header.filename }
    : raw?.media
    ? { type: raw.media.type as MediaType, url: raw.media.url, filename: raw.media.filename }
    : undefined

  const canonical: CanonicalTemplate = {
    name: raw?.name ?? fallback.name,
    category: (raw?.category ?? fallback.category ?? 'GENERAL') as TemplateCategory,
    language: raw?.language ?? fallback.language ?? 'en_US',
    body: { text: parts.join('\n\n') },
    _meta: raw?._meta,
  }
  if (media) canonical.media = media
  if (footer) canonical.footer = footer
  if (buttons.length) canonical.buttons = buttons
  return canonical
}

// ── Legacy blocks → Canonical ─────────────────────────────────────────────────
// Converts the oldest block-based builder format to the new canonical shape.

export function legacyBlocksToCanonical(
  blocks: any[],
  name: string,
  category?: string,
  language?: string,
): CanonicalTemplate {
  const textBlocks  = blocks.filter(b => b.type === 'text')
  const mediaBlock  = blocks.find(b => b.type === 'media')

  const titleBlock  = textBlocks.find((b: any) => b.style === 'title')
  const bodyBlocks  = textBlocks.filter((b: any) => b.style !== 'title' && b.style !== 'footer')
  const footerBlock = textBlocks.find((b: any) => b.style === 'footer')

  const parts: string[] = []
  if (titleBlock?.content) parts.push(`*${titleBlock.content}*`)
  parts.push(...bodyBlocks.map((b: any) => b.content).filter(Boolean))
  if (footerBlock?.content) parts.push(`_${footerBlock.content}_`)

  const canonical: CanonicalTemplate = {
    name,
    category: (category ?? 'GENERAL') as TemplateCategory,
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
