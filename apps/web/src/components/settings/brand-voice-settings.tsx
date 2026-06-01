'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SectionHeading } from '@/components/ui/section-heading'

/**
 * Brand voice + signature editor (HOR-356 follow-up). Writes
 * agent_settings.brand_voice / email_signature via PATCH /api/settings/profile.
 *
 * These power Horace's email drafting (it writes in `brand_voice` and signs
 * with `email_signature`) and gate the composer dock's `setup` state — until
 * both are set, "Ask Horace to draft" shows "Set up your voice", which deep-
 * links here.
 */

interface BrandVoiceSettingsProps {
  brandVoice: string | null
  emailSignature: string | null
}

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
      router.refresh() // re-render the dock's setup gate with fresh values
    } catch {
      setError('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
      <SectionHeading
        title="Brand voice"
        description="How Horace writes on your behalf. Set both to let Horace draft emails in your voice."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label htmlFor="brand-voice">Voice</Label>
        <textarea
          id="brand-voice"
          value={voice}
          onChange={(e) => {
            setVoice(e.target.value)
            setSaved(false)
          }}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Warm but professional, no hype, Australian English. Short sentences, no jargon."
          style={textareaStyle}
        />
        <span style={hintStyle}>1–2 sentences: tone, language, anything to avoid. {voice.length}/1000</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          style={{ ...textareaStyle, fontFamily: 'var(--font-mono)', fontSize: 13 }}
        />
        <span style={hintStyle}>Appended verbatim to every Horace draft — multi-line is fine. {signature.length}/1000</span>
      </div>

      {error && (
        <p style={{ margin: 0, fontSize: 13, color: '#A5511E' }} role="alert">
          {error}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
        {saved && !dirty && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-moss)' }}>
            <Check size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  )
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'var(--font-body)',
  lineHeight: 1.5,
  color: 'var(--color-ink)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  resize: 'vertical',
}

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-stone-aa)',
  fontFamily: 'var(--font-body)',
}
