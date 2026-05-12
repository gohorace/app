'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Eye,
  Users,
  Home,
  Inbox,
  Settings,
  LifeBuoy,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
}

// ── Nav definitions ───────────────────────────────────────────────────────────

const ATTENTION_NAV: NavItem[] = [
  { href: '/dashboard',      label: 'Signals',    icon: Eye   },
  { href: '/contacts',       label: 'Contacts',   icon: Users },
  { href: '/properties/new', label: 'Properties', icon: Home  },
  { href: '/digest',         label: 'Digest',     icon: Inbox },
]

const ACCOUNT_NAV: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help',     label: 'Help',     icon: LifeBuoy },
]

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  orgName: string
  agentFirstName?: string | null
  agentLastName?: string | null
  highSignalCount?: number
  trialDaysLeft?: number | null
}

export function Sidebar({
  orgName,
  agentFirstName,
  agentLastName,
  highSignalCount = 0,
  trialDaysLeft = null,
}: SidebarProps) {
  const pathname = usePathname()

  const initials =
    [agentFirstName?.[0], agentLastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [agentFirstName, agentLastName].filter(Boolean).join(' ') || orgName

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
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
        <SectionLabel>Worth your attention</SectionLabel>
        {ATTENTION_NAV.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            active={isActive(href)}
            badge={href === '/dashboard' && highSignalCount > 0 ? highSignalCount : null}
          />
        ))}

        <SectionLabel className="mt-4">Account</SectionLabel>
        {ACCOUNT_NAV.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={href}
            label={label}
            icon={icon}
            active={isActive(href)}
          />
        ))}
      </nav>

      {/* ── Profile block ── */}
      <div style={{ borderTop: '1px solid rgba(245,240,232,0.08)', padding: '10px 8px' }}>
        <Link
          href="/settings/profile"
          style={{ textDecoration: 'none' }}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C4622D] focus-visible:ring-offset-0"
          aria-label={`${fullName} — open profile settings`}
        >
          {/* Avatar */}
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'rgba(196,98,45,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#C4622D',
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {initials}
            </span>
          </div>

          {/* Name + trial countdown */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: '#FAF7F2',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.2,
              }}
            >
              {fullName}
            </p>
            <p
              style={{
                fontSize: '10px',
                color: 'rgba(245,240,232,0.4)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: '2px',
                lineHeight: 1,
              }}
            >
              {trialDaysLeft != null ? `Trial · ${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left` : orgName}
            </p>
          </div>
        </Link>
      </div>
    </aside>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn('px-5 mb-1', className)}
      style={{
        fontSize: '9px',
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'rgba(245,240,232,0.3)',
        marginTop: '8px',
      }}
    >
      {children}
    </p>
  )
}

// ── Nav link ──────────────────────────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
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
        active ? 'font-medium' : 'font-normal hover:bg-white/[0.06]',
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
      {badge != null && badge > 0 && (
        <span
          style={{
            background: '#C4622D',
            color: '#FAF7F2',
            fontSize: '10px',
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: '9999px',
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  )
}
