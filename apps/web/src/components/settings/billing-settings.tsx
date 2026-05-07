'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'

interface BillingSettingsProps {
  plan: string
  subscriptionStatus: string
  hasStripeCustomer: boolean
  currentPeriodEnd: string | null
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  pro_monthly: 'Pro · Monthly',
  pro_annual: 'Pro · Annual',
}

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment past due',
  canceled: 'Cancelled',
  incomplete: 'Setup incomplete',
  incomplete_expired: 'Setup expired',
  unpaid: 'Unpaid',
  paused: 'Paused',
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function BillingSettings({
  plan,
  subscriptionStatus,
  hasStripeCustomer,
  currentPeriodEnd,
}: BillingSettingsProps) {
  const [loading, setLoading] = useState(false)

  const planLabel = PLAN_LABEL[plan] ?? plan
  const statusLabel = STATUS_LABEL[subscriptionStatus] ?? subscriptionStatus
  const periodEnd = formatDate(currentPeriodEnd)
  const isPro = plan === 'pro_monthly' || plan === 'pro_annual'
  const isTrialing = subscriptionStatus === 'trialing'

  async function openPortal() {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) {
        console.error('Portal failed:', data)
        alert(data.error ?? 'Could not open billing portal')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  async function startProTrial() {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/start-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro_monthly' }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Start trial failed:', data)
        alert(data.error ?? 'Could not start trial')
        setLoading(false)
        return
      }
      window.location.reload()
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Current plan</div>
          <div className="text-lg font-semibold">{planLabel}</div>
          <div className="text-sm text-muted-foreground mt-1">
            Status: {statusLabel}
            {isTrialing && periodEnd && <> · Trial ends {periodEnd}</>}
            {isPro && !isTrialing && periodEnd && <> · Renews {periodEnd}</>}
          </div>
        </div>
      </div>

      {isTrialing && (
        <div className="text-sm bg-muted/50 border rounded-md p-3">
          You&apos;re on a 14-day Pro trial. Add a card before {periodEnd ?? 'the trial ends'} to
          keep Pro features. If you don&apos;t, your workspace drops back to Free — you keep all
          your data.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {hasStripeCustomer && (
          <Button onClick={openPortal} disabled={loading} variant={isPro ? 'default' : 'outline'}>
            {loading ? 'Opening…' : 'Manage billing'}
            <ExternalLink className="w-4 h-4 ml-2" />
          </Button>
        )}
        {!isPro && (
          <Button onClick={startProTrial} disabled={loading} variant="default">
            {loading ? 'Starting…' : 'Start 14-day Pro trial'}
          </Button>
        )}
      </div>
    </div>
  )
}
