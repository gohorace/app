'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, X, Bell, Users, Clock, Loader2, Send, BellPlus } from 'lucide-react'
import { requestPushPermission, savePushSubscription } from '@/components/push-manager'
import { cn } from '@/lib/utils'

type AlertMode = 'threshold' | 'all' | 'hourly_digest'

const ALERT_MODES: { value: AlertMode; icon: React.ElementType; label: string; description: string; note?: string }[] = [
  {
    value: 'threshold',
    icon: Bell,
    label: 'Score milestone',
    description: 'Alert when a contact reaches a score of 50 or above',
  },
  {
    value: 'all',
    icon: Users,
    label: 'All activity',
    description: 'Alert on every activity across all contacts',
    note: 'Can get noisy',
  },
  {
    value: 'hourly_digest',
    icon: Clock,
    label: 'Hourly digest',
    description: 'One grouped alert per hour with top prospects and a summary of their activity',
  },
]

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

interface DiagnosticResult {
  vapidConfigured: boolean
  clientKeyConfigured: boolean
  subscriptionCount: number
}

function PushStatusCard() {
  const [diag, setDiag]             = useState<DiagnosticResult | null>(null)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState<{ ok?: boolean; sent?: number; error?: string } | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResult]   = useState<{ ok?: boolean; contact?: string; scoreDelta?: number; newScore?: number; error?: string } | null>(null)
  const [enabling, setEnabling]     = useState(false)
  const [enableResult, setEnableResult] = useState<{ ok?: boolean; error?: string } | null>(null)

  async function loadDiag() {
    const res = await fetch('/api/push/test').catch(() => null)
    if (!res) return
    const d = await res.json()
    if (!d.error) setDiag(d)
  }

  useEffect(() => { loadDiag() }, [])

  async function enablePush() {
    setEnabling(true)
    setEnableResult(null)
    try {
      const sub = await requestPushPermission()
      if (!sub) {
        setEnableResult({ error: 'Permission denied — check your browser notification settings and try again.' })
        setEnabling(false)
        return
      }
      await savePushSubscription(sub)
      await loadDiag()
      setEnableResult({ ok: true })
    } catch (err) {
      setEnableResult({ error: err instanceof Error ? err.message : String(err) })
    }
    setEnabling(false)
  }

  async function sendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      setTestResult(await res.json())
    } catch {
      setTestResult({ error: 'Request failed' })
    }
    setTesting(false)
  }

  async function simulate() {
    setSimulating(true)
    setSimResult(null)
    try {
      const res = await fetch('/api/push/simulate', { method: 'POST' })
      setSimResult(await res.json())
    } catch {
      setSimResult({ error: 'Request failed' })
    }
    setSimulating(false)
  }

  const subscribed = (diag?.subscriptionCount ?? 0) > 0

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">

        {/* Not yet subscribed — primary CTA */}
        {!subscribed && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(196,98,45,0.1)' }}>
              <BellPlus className="w-5 h-5" style={{ color: '#C4622D' }} />
            </div>
            <div>
              <p className="text-sm font-semibold">Enable push notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Get alerted the moment a hot prospect submits a form or returns to your site
              </p>
            </div>
            <Button
              type="button"
              onClick={enablePush}
              disabled={enabling}
              className="gap-2"
              style={{ background: '#C4622D', color: '#fff' }}
            >
              {enabling
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enabling…</>
                : <><BellPlus className="w-4 h-4" /> Enable on this device</>}
            </Button>
            {enableResult && (
              <p className={cn('text-xs', enableResult.ok ? 'text-green-700' : 'text-destructive')}>
                {enableResult.ok ? '✓ This device is now subscribed.' : `✗ ${enableResult.error}`}
              </p>
            )}
          </div>
        )}

        {/* Subscribed — compact status + test buttons */}
        {subscribed && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="font-medium">
                  {diag!.subscriptionCount} device{diag!.subscriptionCount !== 1 ? 's' : ''} registered
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={sendTest}
                disabled={testing || simulating}
                className="gap-1.5 text-xs shrink-0"
              >
                {testing
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                  : <><Send className="w-3 h-3" /> Send test</>}
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={simulate}
              disabled={simulating || testing}
              className="w-full gap-1.5 text-xs text-muted-foreground"
            >
              {simulating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Simulating…</>
                : 'Simulate return visit for top contact'}
            </Button>
          </div>
        )}

        {/* Simulate result */}
        {simResult && (
          <div className={cn(
            'rounded-md px-3 py-2 text-xs',
            simResult.ok
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          )}>
            {simResult.ok
              ? `✓ Fired for ${simResult.contact} — +${simResult.scoreDelta} pts (score now ${simResult.newScore}). Check your notifications.`
              : `✗ ${simResult.error}`}
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={cn(
            'rounded-md px-3 py-2 text-xs',
            testResult.ok
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-destructive/10 text-destructive border border-destructive/20'
          )}>
            {testResult.ok
              ? `✓ Notification sent to ${testResult.sent} device${(testResult.sent ?? 0) !== 1 ? 's' : ''}. Check your notifications.`
              : `✗ ${testResult.error}`}
          </div>
        )}

      </CardContent>
    </Card>
  )
}


interface Props {
  initial: {
    push_alert_mode:     AlertMode
    alert_threshold:     number
    briefing_emails:     string[]
    timezone:            string
    daily_briefing_hour: number
  }
}

export function NotificationsForm({ initial }: Props) {
  const [alertMode,  setAlertMode]  = useState<AlertMode>(initial.push_alert_mode)
  const [threshold,  setThreshold]  = useState(initial.alert_threshold)
  const [emails,     setEmails]     = useState<string[]>(initial.briefing_emails)
  const [emailInput, setEmailInput] = useState('')
  const [timezone,   setTimezone]   = useState(initial.timezone)
  const [hour,       setHour]       = useState(initial.daily_briefing_hour)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function addEmail(raw: string) {
    const val = raw.trim().toLowerCase()
    if (!val || emails.includes(val)) { setEmailInput(''); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return
    setEmails([...emails, val])
    setEmailInput('')
  }

  function removeEmail(email: string) {
    setEmails(emails.filter((e) => e !== email))
  }

  function handleEmailKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addEmail(emailInput)
    } else if (e.key === 'Backspace' && !emailInput && emails.length) {
      setEmails(emails.slice(0, -1))
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        push_alert_mode:     alertMode,
        alert_threshold:     threshold,
        briefing_emails:     emails,
        timezone,
        daily_briefing_hour: hour,
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

      {/* Push diagnostic */}
      <PushStatusCard />

      {/* Push notifications */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <p className="text-sm font-semibold">Push notifications</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Alerts sent to your device when prospect activity is detected
            </p>
          </div>

          <div className="space-y-2">
            {ALERT_MODES.map(({ value, icon: Icon, label, description, note }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAlertMode(value)}
                className={cn(
                  'w-full text-left rounded-lg border px-4 py-3 transition-colors',
                  alertMode === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'mt-0.5 rounded-md p-1.5',
                    alertMode === value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{label}</p>
                      {note && (
                        <Badge variant="outline" className="text-xs py-0 px-1.5">{note}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                  </div>
                  <div className={cn(
                    'mt-1 h-4 w-4 rounded-full border-2 shrink-0 transition-colors',
                    alertMode === value ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                  )} />
                </div>
              </button>
            ))}
          </div>

          {alertMode === 'threshold' && (
            <div className="flex items-center gap-3 pt-1">
              <Label htmlFor="threshold" className="text-xs shrink-0">Alert at score</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={999}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-20 h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">points or above</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily email round-up */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <p className="text-sm font-semibold">Daily email round-up</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sent every day with your top prospects and recommended actions
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Recipients</Label>
            <div
              className="min-h-[2.5rem] flex flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2 cursor-text"
              onClick={() => inputRef.current?.focus()}
            >
              {emails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 bg-muted rounded px-2 py-0.5 text-xs font-medium"
                >
                  {email}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeEmail(email) }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKey}
                onBlur={() => addEmail(emailInput)}
                placeholder={emails.length === 0 ? 'Add email address…' : ''}
                className="flex-1 min-w-32 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter or comma to add. Add team members to copy them in.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs">Timezone</Label>
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
              <Label htmlFor="hour" className="text-xs">Send at</Label>
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={saving}>
        {saved
          ? <span className="flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4" /> Saved</span>
          : saving ? 'Saving…' : 'Save settings'}
      </Button>
    </form>
  )
}
