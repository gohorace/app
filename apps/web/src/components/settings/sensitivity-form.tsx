'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RadioCard } from '@/components/ui/radio-card'
import { CheckCircle2, Gauge, Activity, Sparkles } from 'lucide-react'
import type { Sensitivity } from '@/lib/sensitivity/thresholds'

interface Option {
  value: Sensitivity
  icon: React.ElementType
  label: string
  description: string
  note?: string
}

const OPTIONS: Option[] = [
  {
    value: 'low',
    icon: Gauge,
    label: 'Low',
    description: "I'll only tap you when something clearly breaks. Fewer nudges, every one worth a look.",
  },
  {
    value: 'medium',
    icon: Activity,
    label: 'Medium',
    description: "I'll flag the moment a pattern shifts.",
    note: 'Most agents start here',
  },
  {
    value: 'high',
    icon: Sparkles,
    label: 'High',
    description: "I'll surface the faintest stir. Earlier warning, more to read, more false starts.",
  },
]

interface Props {
  initial: Sensitivity
}

export function SensitivityForm({ initial }: Props) {
  const [value, setValue] = useState<Sensitivity>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/settings/sensitivity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensitivity: value }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to save')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <p className="italic text-sm leading-normal text-[var(--fg-secondary)] max-w-[58ch]">
        Lead scoring waits for people to clear a bar. I don&rsquo;t. I learn each visitor&rsquo;s normal rhythm and tap you when it shifts &mdash; you decide how big a shift it takes.
      </p>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)] space-y-2">
        {OPTIONS.map(({ value: v, icon: Icon, label, description, note }) => (
          <RadioCard
            key={v}
            selected={value === v}
            onSelect={() => setValue(v)}
            icon={<Icon />}
            title={label}
            description={description}
            note={note}
          />
        ))}
      </div>

      <div className="space-y-1 text-xs text-[var(--fg-tertiary)]">
        <p>The signal sits under every nudge &mdash; you always see what I saw. The call is yours.</p>
        <p>I learn the baselines. You set how sensitive I am to change.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={saving}>
        {saved
          ? <span className="flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" /> Saved</span>
          : saving ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
