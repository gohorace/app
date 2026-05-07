'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { CheckCircle2, Code2, Users, Bell } from 'lucide-react'
import { requestPushPermission, savePushSubscription } from '@/components/push-manager'

const STEPS = [
  { id: 'snippet', label: 'Install snippet', icon: Code2 },
  { id: 'import',  label: 'Import contacts', icon: Users },
  { id: 'alerts',  label: 'Enable alerts',   icon: Bell },
  { id: 'done',    label: 'All set',          icon: CheckCircle2 },
]

interface Props {
  snippetKey: string
  appUrl: string
}

export function OnboardingWizard({ snippetKey, appUrl }: Props) {
  const [step, setStep] = useState(0)
  const [importDone, setImportDone] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [alertsGranted, setAlertsGranted] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const progress = (Math.min(step, STEPS.length - 1) / (STEPS.length - 1)) * 100

  const snippetCode = `<!-- Horace -->
<script>
  window.RIQ = {
    key: '${snippetKey}',
    apiUrl: '${appUrl}/api',
    propertyPattern: '/property/'
  };
</script>
<script src="${appUrl}/tracker.min.js" defer></script>`

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return

    setImporting(true)
    setImportError(null)

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/import', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      setImportError(data.error ?? 'Import failed')
      setImporting(false)
      return
    }

    setImportDone(true)
    setImporting(false)
  }

  async function handleEnableAlerts() {
    setAlertsError(null)
    try {
      const sub = await requestPushPermission()
      if (!sub) {
        setAlertsError('Permission denied. You can enable alerts later in Settings.')
        return
      }
      await savePushSubscription(sub)
      setAlertsGranted(true)
      setTimeout(() => setStep(3), 1200)
    } catch {
      setAlertsError('Something went wrong. You can enable alerts later in Settings.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="space-y-3">
        <Progress value={progress} className="h-1.5" />
        <div className="flex justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done = i < step
            const active = i === step
            return (
              <div key={s.id} className="flex flex-col items-center gap-1">
                <div className={`rounded-full p-1.5 transition-colors ${
                  done   ? 'bg-green-100 text-green-600' :
                  active ? 'bg-primary/10 text-primary' :
                           'bg-muted text-muted-foreground'
                }`}>
                  {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={`text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Step 1: Install snippet */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Install the tracking snippet</CardTitle>
            <CardDescription>
              Paste this before the closing <code className="text-xs bg-muted px-1 rounded">&lt;/body&gt;</code> tag on every page of your website.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all pr-12">
                <code>{snippetCode}</code>
              </pre>
              <div className="absolute top-2 right-2">
                <CopyButton text={snippetCode} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">Snippet key</Badge>
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{snippetKey}</code>
            </div>
            <p className="text-xs text-muted-foreground">
              Using WordPress?{' '}
              <a href="/settings/snippet" className="underline">See installation guide →</a>
            </p>
            <Button className="w-full" onClick={() => setStep(1)}>
              Snippet installed — continue
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Import contacts */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Import your contacts</CardTitle>
            <CardDescription>
              Upload a CSV export from your CRM. We'll match contacts to website activity automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {importDone ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <p className="font-medium">Contacts imported</p>
                <p className="text-sm text-muted-foreground">Horace will start matching them to website activity.</p>
              </div>
            ) : (
              <form onSubmit={handleImport} className="space-y-4">
                <label className="block">
                  <span className="sr-only">Choose CSV file</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    required
                    className="block w-full text-sm text-muted-foreground
                      file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                      file:text-sm file:font-medium file:bg-primary file:text-primary-foreground
                      hover:file:bg-primary/90 cursor-pointer"
                  />
                </label>
                {importError && <p className="text-sm text-destructive">{importError}</p>}
                <Button type="submit" className="w-full" disabled={importing}>
                  {importing ? 'Importing…' : 'Upload CSV'}
                </Button>
              </form>
            )}
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setStep(2)}
            >
              {importDone ? 'Continue →' : 'Skip for now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Enable push alerts */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Enable prospect alerts</CardTitle>
            <CardDescription>
              Get a push notification the moment a hot prospect submits a form, returns to your site, or hits a high score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {alertsGranted ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
                <p className="font-medium">Alerts enabled</p>
                <p className="text-sm text-muted-foreground">You'll be notified the moment something important happens.</p>
              </div>
            ) : (
              <Button className="w-full" onClick={handleEnableAlerts}>
                Allow alerts
              </Button>
            )}
            {alertsError && (
              <p className="text-sm text-muted-foreground text-center">{alertsError}</p>
            )}
            {!alertsGranted && (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => setStep(3)}
              >
                Skip for now
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Completion */}
      {step === 3 && (
        <Card>
          <CardContent className="pt-8 pb-6 flex flex-col items-center text-center gap-4">
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%',
              background: 'rgba(196,98,45,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#C4622D' }} />
            </div>

            <div className="space-y-1.5">
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1612', letterSpacing: '-0.015em', fontFamily: 'var(--font-display)' }}>
                You&rsquo;re all set.
              </h2>
              <p style={{ fontSize: '14px', color: '#8C7B6B', lineHeight: 1.65, maxWidth: '320px' }}>
                Horace is now watching your site. You&rsquo;ll get your first brief tonight, and a real-time alert the moment a known contact returns.
              </p>
            </div>

            <div style={{
              width: '100%', background: 'rgba(140,123,107,0.07)',
              borderRadius: '8px', padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: '8px',
              textAlign: 'left',
            }}>
              {[
                { dot: '#C4622D', text: 'Real-time alerts when high-intent contacts visit' },
                { dot: '#B5922A', text: 'Daily brief with your top prospects and recommended actions' },
                { dot: '#3D5246', text: 'Intent scores that update as contacts engage' },
              ].map(({ dot, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <span style={{ fontSize: '12.5px', color: '#2E2823' }}>{text}</span>
                </div>
              ))}
            </div>

            <Button
              className="w-full mt-1"
              style={{ background: '#C4622D', color: '#FAF7F2' }}
              onClick={() => { window.location.href = '/dashboard' }}
            >
              Open Horace →
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
