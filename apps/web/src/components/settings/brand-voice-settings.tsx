'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SectionHeading } from '@/components/ui/section-heading'
import { cn } from '@/lib/utils'

/**
 * Brand voice + signature editor (HOR-356 follow-up). Writes
 * agent_settings.brand_voice / email_signature via PATCH /api/settings/profile.
 *
 * These power Horace's email drafting (it writes in `brand_voice` and signs
 * with `email_signature`) and gate the composer dock's `setup` state — until
 * both are set, "Ask Horace to draft" shows "Set up your voice", which deep-
 * links here (/settings#brand-voice).
 */

interface BrandVoiceSettingsProps {
  brandVoice: string | null
  emailSignature: string | null
}

// Mirrors the Input component's classes (border-input / bg-background / focus
// ring), adapted for a multi-line field.
const textareaClass =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function BrandVoiceSettings({ brandVoice, emailSignature }: BrandVoiceSettingsProps) {
  const router = useRouter()
  const [voice, setVoice] = useState(brandVoice ?? '')
  const [signature, setSignature] = useState(emailSignature ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = voice !== (brandVoice ?? '') || signature !== (emailSignature ?? '')

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_voice: voice, email_signature: signature }),
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
          <textarea
            id="email-signature"
            value={signature}
            onChange={(e) => {
              setSignature(e.target.value)
              setSaved(false)
            }}
            maxLength={1000}
            rows={4}
            placeholder={'e.g.\nJames Reid\nReid & Co · Paddington\n0400 000 000'}
            className={cn(textareaClass, 'min-h-[104px] resize-y font-mono')}
          />
          <p className="text-xs text-[var(--fg-tertiary)]">
            Appended verbatim to every Horace draft — multi-line is fine. {signature.length}/1000
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
