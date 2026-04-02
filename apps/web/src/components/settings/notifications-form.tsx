'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  initial: {
    sms_enabled: boolean
    agent_phone: string | null
    sms_threshold_score: number
    agent_email: string | null
    weekly_briefing_day: number
  }
}

export function NotificationsForm({ initial }: Props) {
  const [smsEnabled, setSmsEnabled] = useState(initial.sms_enabled)
  const [phone, setPhone] = useState(initial.agent_phone ?? '')
  const [threshold, setThreshold] = useState(initial.sms_threshold_score)
  const [email, setEmail] = useState(initial.agent_email ?? '')
  const [briefingDay, setBriefingDay] = useState(initial.weekly_briefing_day)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sms_enabled: smsEnabled,
        agent_phone: phone.trim() || null,
        sms_threshold_score: threshold,
        agent_email: email.trim() || null,
        weekly_briefing_day: briefingDay,
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
    <form onSubmit={handleSave} className="space-y-8">
      {/* SMS alerts */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">SMS alerts</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get a text when a lead hits a milestone
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={smsEnabled}
            onClick={() => setSmsEnabled(!smsEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              smsEnabled ? 'bg-primary' : 'bg-input'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                smsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {smsEnabled && (
          <div className="space-y-4 pl-0 border-l-2 border-border pl-4 ml-1">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Your mobile number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+61 400 000 000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">Include country code, e.g. +61</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="threshold">Alert threshold score</Label>
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
                <p className="text-xs text-muted-foreground">
                  Send SMS when a lead&apos;s score crosses this number
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* Weekly briefing */}
      <div className="space-y-4">
        <div>
          <p className="font-medium text-sm">Weekly email briefing</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            A summary of your top leads and activity sent each week
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Briefing email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="agent@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="day">Send on</Label>
          <select
            id="day"
            value={briefingDay}
            onChange={(e) => setBriefingDay(Number(e.target.value))}
            className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {DAYS.map((day, i) => (
              <option key={day} value={i}>{day}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Emails send at 7:00 AM</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save settings'}
      </Button>
    </form>
  )
}
