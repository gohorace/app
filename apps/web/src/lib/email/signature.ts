/**
 * Email signature composition + sanitisation (HOR-xxx).
 *
 * - `sanitiseSignatureHtml` is the server-side guard for what the agent's
 *   rich-text editor sends. Whitelist follows the brief: a tiny set of inline
 *   tags + a constrained set of styles. No scripts, no event handlers, no
 *   tracking pixels, no `<style>` blocks, no class names, no data attrs.
 *   `data:` and `cid:` are excluded from allowed schemes by omission.
 *
 * - `signatureToPlainText` derives the plain-text fallback we keep in the
 *   legacy `agent_settings.email_signature` column so unchanged consumers
 *   (lib/ai/signal-draft.ts, lib/outreach/draft-outreach.ts, lib/mcp/*)
 *   keep producing readable signatures.
 *
 * - `composeSignatureHtml` is the render-side helper: it joins the optional
 *   logo `<img>` with the sanitised HTML body into the block we splice onto
 *   outbound message HTML.
 */

import sanitizeHtml, { type IOptions } from 'sanitize-html'

const SIGNATURE_SANITIZE_OPTIONS: IOptions = {
  allowedTags: ['a', 'img', 'br', 'p', 'span', 'strong', 'em', 'b', 'i'],
  allowedAttributes: {
    a: ['href'],
    img: ['src', 'alt'],
    span: ['style'],
    p: ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowedStyles: {
    span: {
      color: [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z\-]+$/i],
      'font-weight': [/^(?:bold|normal|\d{3})$/i],
      'font-style': [/^(?:italic|normal)$/i],
      'text-decoration': [/^(?:underline|none)$/i],
    },
    p: {
      color: [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z\-]+$/i],
      'font-weight': [/^(?:bold|normal|\d{3})$/i],
      'font-style': [/^(?:italic|normal)$/i],
      'text-decoration': [/^(?:underline|none)$/i],
    },
  },
  // Drop anything not on the allowlist (default), and also strip the contents
  // of disallowed tags so e.g. <style>…</style> doesn't leave its CSS behind.
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'noscript'],
}

/** Server-side sanitise the editor's output. Empty input → empty string. */
export function sanitiseSignatureHtml(input: string): string {
  if (!input) return ''
  return sanitizeHtml(input, SIGNATURE_SANITIZE_OPTIONS).trim()
}

/** Strip all tags to get a plain-text fallback. */
export function signatureToPlainText(html: string): string {
  if (!html) return ''
  // Preserve newlines for <br> and <p>; sanitize-html with empty allowedTags
  // collapses everything else.
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
  return stripped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

interface ComposeOptions {
  /** Already-sanitised signature HTML. */
  html: string | null
  /** Already-validated logo URL. */
  logoUrl: string | null
}

/**
 * Compose the signature block that gets spliced onto outbound HTML. Returns
 * an empty string when neither piece is present so callers can append
 * unconditionally.
 *
 * Layout: a single `<br>` separator before the block, the optional logo as
 * an `<img>` on its own line, then the HTML body. The wrapping `<div>`
 * isolates the signature for downstream sanitisers and email clients.
 */
export function composeSignatureHtml({ html, logoUrl }: ComposeOptions): string {
  const hasHtml = !!html && html.trim().length > 0
  const hasLogo = !!logoUrl && logoUrl.trim().length > 0
  if (!hasHtml && !hasLogo) return ''

  const parts: string[] = []
  if (hasLogo) {
    const safeUrl = encodeURI(logoUrl!.trim())
    parts.push(
      `<p style="margin:0 0 8px;"><img src="${safeUrl}" alt="" style="max-height:64px;display:block;" /></p>`,
    )
  }
  if (hasHtml) {
    parts.push(html!.trim())
  }
  return `<br /><div class="horace-signature">${parts.join('')}</div>`
}
