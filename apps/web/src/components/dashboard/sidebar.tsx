'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, Users, MapPin, Bell, Settings, ListChecks, DoorOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
  badgeFrom?: 'attention'
}

// HOR-144: Lists landed in the Data group alongside Contacts + Properties.
// Mobile tab bar stays at 4 tabs (Today / Contacts / Properties / More) —
// the List filter chip inside Contacts is the primary mobile entry point,
// and the desktop sidebar handles direct browsing.

type NavSection = {
  label: string | null
  items: NavItem[]
}

// ── Nav definitions ───────────────────────────────────────────────────────────
// IA per V1 design: Today / Data / Notifications / Account. Signals (/dashboard)
// is retired and redirects to /digest. Help + Import live under Settings now.

const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ href: '/digest', label: 'Today', icon: Sun }],
  },
  {
    label: 'Data',
    items: [
      { href: '/contacts',    label: 'Contacts',    icon: Users      },
      { href: '/lists',       label: 'Lists',       icon: ListChecks },
      { href: '/properties',  label: 'Properties',  icon: MapPin     },
      // HOR-148: Doorstep v1 — agent-facing label is "Open homes" while
      // inspection_type only takes 'open_home'. v2 adds 'private' and
      // we'll rename to "Inspections" then.
      { href: '/inspections', label: 'Open homes',  icon: DoorOpen   },
    ],
  },
  {
    label: null,
    items: [{ href: '/notifications', label: 'Notifications', icon: Bell, badgeFrom: 'attention' }],
  },
  {
    label: 'Account',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  orgName: string
  agentFirstName?: string | null
  agentLastName?: string | null
  avatarUrl?: string | null
  attentionCount?: number
  trialDaysLeft?: number | null
}

export function Sidebar({
  orgName,
  agentFirstName,
  agentLastName,
  avatarUrl,
  attentionCount = 0,
  trialDaysLeft = null,
}: SidebarProps) {
  const pathname = usePathname()

  const initials =
    [agentFirstName?.[0], agentLastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [agentFirstName, agentLastName].filter(Boolean).join(' ') || orgName

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
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
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si === 0 ? undefined : 'mt-4'}>
            {section.label && <SectionLabel>{section.label}</SectionLabel>}
            {section.items.map(({ href, label, icon, badgeFrom }) => (
              <NavLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={isActive(href)}
                badge={badgeFrom === 'attention' && attentionCount > 0 ? attentionCount : null}
              />
            ))}
          </div>
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
              background: avatarUrl ? 'transparent' : 'rgba(196,98,45,0.18)',
              backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {!avatarUrl && (
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
            )}
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
