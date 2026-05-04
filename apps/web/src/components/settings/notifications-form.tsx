'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2 } from 'lucide-react'

const TIMEZONES = [
  { value: 'Australia/Sydney',    label: 'Sydney / Melbourne (AEST)' },
  { value: 'Australia/Brisbane',  label: 'Brisbane (AEST, no DST)'   },
  { value: 'Australia/Adelaide',  label: 'Adelaide (ACST)'           },
  { value: 'Australia/Perth',     label: 'Perth (AWST)'              },
  { value: 'Australia/Darwin',    label: 'Darwin (ACST)'             },
  { value: 'Pacific/Auckland',    label: 'Auckland (NZST)'           },
  { value: 'Asia/Singapore',      label: 'Singapore (SGT)'           },
  { value: 'Europe/London',       label: 'London (GMT/BST)'          },
  { value: 'America/New_York',    label: 'New York (ET)'             },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)'          },
]

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'am' : 'pm'
  const h = i % 12 === 0 ? 12 : i % 12
  return { value: i, label: `${h}:00 ${ampm}` }
})

interface Props {
  initial: {
    agent_email:         string
    timezone:            string
    daily_briefing_hour: number
    alert_threshold:     number
  }
}

export function NotificationsForm({ initial }: Props) {
  const [email,     setEmail]     = useState(initial.agent_email)
  const [timezone,  setTimezone]  = useState(initial.timezone)
  const [hour,      setHour]      = useState(initial.daily_briefing_hour)
  const [threshold, setThreshold] = useState(initial.alert_threshold)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_email:         email.trim() || null,
        timezone,
        daily_briefing_hour: hour,
        alert_threshold:     threshold,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to save')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }

    setSaving(false)
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">

      {/* Daily brief */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <p className="text-sm font-medium">Daily brief</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sent every day with your top prospects and recommended actions
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Send to</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hour">Send at</Label>
              <select
                id="hour"
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Push alerts */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <p className="text-sm font-medium">Prospect alerts</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Push notifications for form submits, return visits, and score milestones
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="threshold">Alert when score reaches</Label>
            <div className="flex items-center gap-3">
              <Input
                id="threshold"
                type="number"
                min={1}
                max={999}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">points</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={saving}>
        {saved
          ? <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Saved</span>
          : saving ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
