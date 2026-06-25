'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionHeading } from '@/components/ui/section-heading'
import { cn } from '@/lib/utils'
import { SignatureEditor } from '@/components/settings/signature-editor'

/**
 * Brand voice + signature editor. Writes agent_settings.brand_voice plus the
 * HTML signature trio (email_signature_html, email_signature_logo_url, and
 * the derived plain-text email_signature) via PATCH /api/settings/profile.
 *
 * These power Horace's email drafting (it writes in `brand_voice` and signs
 * with the configured signature) and gate the composer dock's `setup` state —
 * until both are set, "Ask Horace to draft" shows "Set up your voice", which
 * deep-links here (/settings#brand-voice).
 */

interface BrandVoiceSettingsProps {
  brandVoice: string | null
  emailSignatureHtml: string | null
  /** Legacy plain-text signature from before the HTML editor — used as the
   *  initial editor content for agents who haven't re-saved since the upgrade. */
  emailSignatureLegacyText: string | null
  emailSignatureLogoUrl: string | null
}

const textareaClass =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const SIGNATURE_PLACEHOLDER = 'No signature yet. Paste yours in — Horace will tidy it up.'
const IMAGES_STRIPPED_COPY =
  "Pasted images won't survive the send — they'll break for whoever opens your email. Add your logo by URL below and Horace will handle the rest."

/** Wrap a legacy plain-text signature into the editor's HTML shape so the
 *  TipTap surface rehydrates with the existing value the first time a
 *  pre-upgrade agent opens this surface. */
function legacyTextToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paras.length === 0) return ''
  return paras.map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')
}

export function BrandVoiceSettings({
  brandVoice,
  emailSignatureHtml,
  emailSignatureLegacyText,
  emailSignatureLogoUrl,
}: BrandVoiceSettingsProps) {
  const router = useRouter()
  const [voice, setVoice] = useState(brandVoice ?? '')
  const initialSignatureHtml =
    emailSignatureHtml ?? (emailSignatureLegacyText ? legacyTextToHtml(emailSignatureLegacyText) : '')
  const [signatureHtml, setSignatureHtml] = useState(initialSignatureHtml)
  const [logoUrl, setLogoUrl] = useState(emailSignatureLogoUrl ?? '')
  const [showImagesStripped, setShowImagesStripped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    voice !== (brandVoice ?? '') ||
    signatureHtml !== initialSignatureHtml ||
    logoUrl !== (emailSignatureLogoUrl ?? '')

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_voice: voice,
          email_signature_html: signatureHtml,
          email_signature_logo_url: logoUrl,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'Failed to save.')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh() // re-render the dock's setup gate with fresh values
    } catch {
      setError('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="brand-voice" className="max-w-[660px] scroll-mt-6 space-y-5 p-4 md:p-8">
      <SectionHeading
        title="Brand voice"
        description="How Horace writes on your behalf. Set both to let Horace draft emails in your voice."
      />

      <div className="space-y-5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
        <div className="space-y-1.5">
          <Label htmlFor="brand-voice-input">Voice</Label>
          <textarea
            id="brand-voice-input"
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value)
              setSaved(false)
            }}
            maxLength={1000}
            rows={3}
            placeholder="e.g. Warm but professional, no hype, Australian English. Short sentences, no jargon."
            className={cn(textareaClass, 'min-h-[76px] resize-y')}
          />
          <p className="text-xs text-[var(--fg-tertiary)]">
            1–2 sentences: tone, language, anything to avoid. {voice.length}/1000
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-signature">Email signature</Label>
          <SignatureEditor
            value={signatureHtml}
            onChange={(html) => {
              setSignatureHtml(html)
              setSaved(false)
            }}
            onImagesStrippedFromPaste={() => {
              setShowImagesStripped(true)
              setSaved(false)
            }}
            placeholder={SIGNATURE_PLACEHOLDER}
          />
          <p className="text-xs text-[var(--fg-tertiary)]">
            Paste the one you use in Gmail or Outlook — formatting carries over, images don&rsquo;t.
          </p>
          {showImagesStripped && (
            <div
              role="status"
              className="rounded-md border border-[rgba(196,98,45,0.32)] bg-[rgba(196,98,45,0.08)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-terracotta-text,#9C4A1F)]"
            >
              {IMAGES_STRIPPED_COPY}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signature-logo-url">Logo image URL</Label>
          <Input
            id="signature-logo-url"
            type="url"
            value={logoUrl}
            onChange={(e) => {
              setLogoUrl(e.target.value)
              setSaved(false)
            }}
            placeholder="https://"
          />
          <p className="text-xs text-[var(--fg-tertiary)]">
            Paste a public link to your logo. Right-click an image online and choose &ldquo;copy image
            address&rdquo;.
          </p>
        </div>

        {error && <p className="text-sm text-[var(--color-terracotta)]">{error}</p>}

        <div className="flex items-center justify-end gap-2.5">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-moss)]">
              <Check className="size-3.5" />
              Saved
            </span>
          )}
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
