'use client'

import { useState } from 'react'
import { Info, CreditCard, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CardLabel } from '@/components/ui/card-label'
import { SettingRow } from '@/components/ui/setting-row'

interface BillingSettingsProps {
  plan: string
  subscriptionStatus: string
  hasStripeCustomer: boolean
  currentPeriodEnd: string | null
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free (legacy)',
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

  const statusVariant: 'moss' | 'amber' | 'stone' =
    subscriptionStatus === 'active' ? 'moss' :
    subscriptionStatus === 'trialing' ? 'amber' : 'stone'

  async function openPortal() {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) {
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
    <div className="space-y-4">
      {/* Dark plan card */}
      <div className="rounded-lg bg-[var(--color-charcoal)] p-[22px]">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgba(245,240,232,0.4)]">
              Current plan
            </div>
            <div className="font-serif text-[28px] font-semibold leading-none tracking-tight text-[var(--color-cream)]">
              {planLabel}
            </div>
          </div>
          <Badge variant={statusVariant} dot>{statusLabel}</Badge>
        </div>
        {(periodEnd || isTrialing) && (
          <div className="flex flex-wrap gap-7 border-t border-[rgba(245,240,232,0.1)] pt-4">
            {isTrialing && periodEnd && (
              <div>
                <div className="mb-0.5 text-[11px] text-[rgba(245,240,232,0.4)]">Trial ends</div>
                <div className="font-mono text-sm font-medium text-[var(--color-cream)]">{periodEnd}</div>
              </div>
            )}
            {isPro && !isTrialing && periodEnd && (
              <div>
                <div className="mb-0.5 text-[11px] text-[rgba(245,240,232,0.4)]">Renews</div>
                <div className="font-mono text-sm font-medium text-[var(--color-cream)]">{periodEnd}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment method card */}
      <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
        <CardLabel className="px-4 pt-4">Payment method</CardLabel>
        <SettingRow
          icon={<CreditCard />}
          title="Billing portal"
          description="Manage your card, download invoices, and update payment details."
          last
        >
          {hasStripeCustomer ? (
            <Button variant="secondary" size="sm" onClick={openPortal} disabled={loading}>
              <ExternalLink className="size-3.5" />
              {loading ? 'Opening…' : 'Manage billing'}
            </Button>
          ) : (
            <Button size="sm" onClick={startProTrial} disabled={loading}>
              {loading ? 'Starting…' : 'Start 14-day Pro trial'}
            </Button>
          )}
        </SettingRow>
      </div>

      {/* Info note */}
      <div className="flex items-center gap-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <Info className="size-[15px] shrink-0 text-[var(--fg-tertiary)]" />
        <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
          Invoices, receipts, and card changes are handled in the secure billing portal.
        </p>
      </div>
    </div>
  )
}
