'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  User,
  Users,
  CreditCard,
  Globe,
  Code,
  Bell,
  MapPin,
  Inbox,
  BarChart2,
  Link2,
  Cable,
  Plug,
  ShieldOff,
  Key,
  Database,
  Upload,
  LifeBuoy,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: typeof Users
  /** Hidden for support seats (mirrors NAV_ITEMS_HIDDEN_FOR_SUPPORT). */
  adminOnly?: boolean
  /** Behind NEXT_PUBLIC_EMBED_ENABLED (HOR-285). */
  embedGated?: boolean
}
interface NavGroup {
  label: string
  items: NavItem[]
}

// PR2 mirrors the existing routes 1:1 (pre-merge). PR3 collapses
// Connections+Integrations and API tokens+API & data.
const NAV_GROUPS: NavGroup[] = [
  { label: 'Account', items: [{ href: '/settings', label: 'Profile', icon: User }] },
  {
    label: 'Workspace',
    items: [
      { href: '/settings/team', label: 'Team', icon: Users, adminOnly: true },
      { href: '/settings/billing', label: 'Plan & billing', icon: CreditCard, adminOnly: true },
    ],
  },
  {
    label: 'Doorstep',
    items: [
      { href: '/settings/custom-domain', label: 'Custom domain', icon: Globe },
      { href: '/settings/embed', label: 'Website embed', icon: Code, embedGated: true },
    ],
  },
  {
    label: 'Signals & alerts',
    items: [
      { href: '/settings/notifications', label: 'Alerts & briefing', icon: Bell },
      { href: '/settings/core-markets', label: 'Core markets', icon: MapPin },
      { href: '/settings/portal', label: 'Portal address', icon: Inbox },
      { href: '/settings/scoring', label: 'Scoring rules', icon: BarChart2 },
      { href: '/settings/tracked-links', label: 'Tracked links', icon: Link2 },
      { href: '/settings/snippet', label: 'Install snippet', icon: Code },
    ],
  },
  {
    label: 'Data & integrations',
    items: [
      { href: '/settings/connections', label: 'Connections', icon: Cable },
      { href: '/settings/integrations', label: 'Integrations', icon: Plug },
      { href: '/settings/email-exclusions', label: 'Email exclusions', icon: ShieldOff },
      { href: '/settings/api-tokens', label: 'API tokens', icon: Key },
      { href: '/settings/api-and-data', label: 'API & data', icon: Database },
      { href: '/import', label: 'Import contacts', icon: Upload },
    ],
  },
  { label: 'Help', items: [{ href: '/help', label: 'Help & guides', icon: LifeBuoy }] },
]

const EMBED_ENABLED = process.env.NEXT_PUBLIC_EMBED_ENABLED === 'true'

function isActive(pathname: string, href: string) {
  return pathname === href
}

export function SettingsNav({ seatType = 'agent' }: { seatType?: 'agent' | 'support' }) {
  const pathname = usePathname()
  const router = useRouter()

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => {
      if (item.embedGated && !EMBED_ENABLED) return false
      if (item.adminOnly && seatType === 'support') return false
      return true
    }),
  })).filter((g) => g.items.length > 0)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Desktop rail */}
      <nav className="hidden w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] md:flex">
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {groups.map((group) => (
            <div key={group.label} className="mb-3.5">
              <div className="px-2.5 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--fg-tertiary)]">
                {group.label}
              </div>
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'mb-px flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-[var(--bg-selected)] font-medium text-[var(--fg-primary)]'
                        : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-[var(--color-terracotta)]' : 'text-[var(--fg-secondary)]',
                      )}
                    />
                    <span>{label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--border-subtle)] p-3">
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </nav>

      {/* Mobile tab strip */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-4 md:hidden">
        {groups.flatMap((g) => g.items).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-3 text-sm transition-colors',
                active
                  ? 'border-[var(--color-terracotta)] font-medium text-[var(--fg-primary)]'
                  : 'border-transparent text-[var(--fg-secondary)]',
              )}
            >
              <Icon
                className={cn(
                  'size-[15px]',
                  active ? 'text-[var(--color-terracotta)]' : 'text-[var(--fg-secondary)]',
                )}
              />
              {label}
            </Link>
          )
        })}
      </div>
    </>
  )
}
