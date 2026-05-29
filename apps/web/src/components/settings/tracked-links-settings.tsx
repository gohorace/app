'use client'

import { useState } from 'react'
import { Link as LinkIcon, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
    <div className="p-4 md:p-8 space-y-5 max-w-lg">
      <div>
        <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '24px', color: '#1A1612' }}>
          Tracked links
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every contact gets a tracked link you can paste into 1:1 emails. When the
          recipient clicks, Horace stitches their browser to the contact and
          identifies all future visits to your site.
        </p>
      </div>

      <div style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: '12px',
        padding: '20px',
      }}>
        <div className="flex items-start gap-3 mb-4">
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'rgba(196,98,45,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <LinkIcon style={{ width: '15px', height: '15px', color: '#C4622D' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#1A1612' }}>Default destination</p>
            <p className="text-xs mt-0.5" style={{ color: '#8C7B6B' }}>
              Where every tracked link sends people unless overridden on the contact.
              For stitching to work, this must be a page on your tracked website.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-link-url" className="text-xs font-medium" style={{ color: '#5A4D40' }}>
            Default site URL
          </Label>
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
          <p className="text-xs mt-2" style={{ color: '#A5511E' }}>{error}</p>
        )}

        <div className="flex items-center gap-3 mt-4">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#3D5246' }}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
