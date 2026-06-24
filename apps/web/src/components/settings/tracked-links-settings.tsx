'use client'

import { useState } from 'react'
import { Link as LinkIcon, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionHeading } from '@/components/ui/section-heading'

interface Props {
  defaultUrl: string | null
}

export function TrackedLinksSettings({ defaultUrl }: Props) {
  const [value, setValue] = useState(defaultUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/tracked-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_link_url: value.trim() === '' ? null : value }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to save')
      } else {
        setSaved(true)
        setValue(data.default_link_url ?? '')
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {
      setError('Network error — try again')
    }
    setSaving(false)
  }

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-[660px]">
      <SectionHeading
        title="Website URL"
        description="The one website Horace works with for you. Every contact gets a tracked link to it you can paste into 1:1 emails — when they click, Horace stitches their browser to the contact and identifies all future visits to your site."
      />

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[rgba(196,98,45,0.1)]">
            <LinkIcon className="size-[15px] text-[var(--color-terracotta)]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--fg-primary)]">Default destination</p>
            <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
              Where every tracked link sends people unless overridden on the contact.
              For stitching to work, this must be a page on your tracked website.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-link-url">Default site URL</Label>
          <Input
            id="default-link-url"
            type="url"
            inputMode="url"
            placeholder="https://yourdomain.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <p className="mt-2 text-xs text-[var(--color-terracotta)]">{error}</p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-moss)]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
