'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Eye,
  Users,
  Bell,
  Code,
  BarChart2,
  Key,
  CreditCard,
  Inbox,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
  badge?: number | null
}

// ── Nav definitions ───────────────────────────────────────────────────────────

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Signals',  icon: Eye   },
  { href: '/leads',     label: 'Contacts', icon: Users },
  { href: '/activity',  label: 'Activity', icon: Bell  },
]

const SETTINGS_NAV: NavItem[] = [
  { href: '/settings/notifications', label: 'Alerts & briefing',  icon: Bell       },
  { href: '/settings/portal',        label: 'Portal address',      icon: Inbox      },
  { href: '/settings/snippet',       label: 'Install snippet',     icon: Code       },
  { href: '/settings/scoring',       label: 'Scoring rules',       icon: BarChart2  },
  { href: '/settings/billing',       label: 'Plan & billing',      icon: CreditCard },
  { href: '/settings/api-tokens',    label: 'API & integrations',  icon: Key        },
]

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  orgName: string
  agentFirstName?: string | null
  agentLastName?: string | null
  agentEmail?: string | null
  unreadActivity?: number
}

export function Sidebar({ orgName, agentFirstName, agentLastName, unreadActivity = 0 }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()

  const isSettings = pathname.startsWith('/settings')

  const initials = [agentFirstName?.[0], agentLastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName  = [agentFirstName, agentLastName].filter(Boolean).join(' ') || orgName

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      style={{ background: '#2E2823', width: '220px', minWidth: '220px' }}
      className="h-full flex flex-col overflow-hidden"
    >
      {/* ── Wordmark ── */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-6">
        <div
          className="rounded-full shrink-0"
          style={{ width: '9px', height: '9px', background: '#C4622D' }}
        />
        <span
          className="font-display font-semibold"
          style={{ fontSize: '20px', color: '#FAF7F2', letterSpacing: '-0.01em' }}
        >
          Horace
        </span>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-0">
        {isSettings ? (
          /* ── Settings panel ── */
          <>
            {/* Back */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-5 py-2.5 mb-1 transition-colors hover:bg-white/[0.06]"
              style={{ color: 'rgba(245,240,232,0.4)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}
            >
              <ChevronLeft style={{ width: '14px', height: '14px' }} />
              Back
            </Link>

            <p
              className="px-5 mb-1"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.3)',
                marginTop: '12px',
              }}
            >
              Settings
            </p>

            {SETTINGS_NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href)
              return (
                <NavLink key={href} href={href} label={label} icon={Icon} active={active} />
              )
            })}
          </>
        ) : (
          /* ── Main panel ── */
          <>
            <p
              className="px-5 mb-1"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.3)',
                marginTop: '8px',
              }}
            >
              Intelligence
            </p>

            {MAIN_NAV.map(({ href, label, icon: Icon }) => {
              const badge = href === '/activity' && unreadActivity > 0 ? unreadActivity : null
              return (
                <NavLink key={href} href={href} label={label} icon={Icon} active={isActive(href)} badge={badge} />
              )
            })}
          </>
        )}
      </nav>

      {/* ── Footer ── */}
      {isSettings ? (
        /* Settings footer — sign out only */
        <div style={{ borderTop: '1px solid rgba(245,240,232,0.08)', padding: '12px 8px' }}>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 rounded transition-colors hover:bg-white/[0.06]"
            style={{ color: 'rgba(245,240,232,0.45)', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <LogOut style={{ width: '15px', height: '15px', flexShrink: 0 }} />
            Sign out
          </button>
        </div>
      ) : (
        /* Main footer — profile card with chevron → /settings */
        <div style={{ borderTop: '1px solid rgba(245,240,232,0.08)', padding: '10px 8px' }}>
          <Link
            href="/settings"
            style={{ textDecoration: 'none' }}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded transition-colors hover:bg-white/[0.06] group"
          >
            {/* Avatar */}
            <div style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: '#C4622D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#FAF7F2',
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}>
                {initials}
              </span>
            </div>

            {/* Name + agency */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'rgba(245,240,232,0.75)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.2,
              }}>
                {fullName}
              </p>
              <p style={{
                fontSize: '10px',
                color: 'rgba(245,240,232,0.35)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: '1px',
                lineHeight: 1,
              }}>
                {orgName}
              </p>
            </div>

            {/* Chevron */}
            <ChevronRight
              style={{ width: '13px', height: '13px', color: 'rgba(245,240,232,0.25)', flexShrink: 0 }}
              className="group-hover:text-[rgba(245,240,232,0.5)] transition-colors"
            />
          </Link>
        </div>
      )}
    </aside>
  )
}

// ── Shared nav link ───────────────────────────────────────────────────────────

function NavLink({ href, label, icon: Icon, active, badge }: {
  href: string
  label: string
  icon: React.ElementType
  active: boolean
  badge?: number | null
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 px-5 py-2.5 text-[13px] transition-colors',
        active ? 'font-medium' : 'font-normal hover:bg-white/[0.06]'
      )}
      style={{
        color: active ? '#FAF7F2' : 'rgba(245,240,232,0.55)',
        background: active ? 'rgba(196,98,45,0.18)' : undefined,
        transitionDuration: '180ms',
        textDecoration: 'none',
      }}
    >
      <Icon
        className="shrink-0"
        style={{ width: '16px', height: '16px', color: active ? '#C4622D' : undefined }}
      />
      <span className="flex-1">{label}</span>
      {badge != null && (
        <span style={{
          background: '#C4622D',
          color: '#FAF7F2',
          fontSize: '10px',
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: '9999px',
        }}>
          {badge}
        </span>
      )}
    </Link>
  )
}
