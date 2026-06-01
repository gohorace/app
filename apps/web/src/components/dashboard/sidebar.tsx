'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  Building,
  DoorOpen,
  HelpCircle,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  Waves,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarPref } from '@/lib/ui/use-sidebar-pref'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
}

type NavSection = {
  label: string
  items: NavItem[]
}

// ── Nav definitions ───────────────────────────────────────────────────────────
// v2 IA per the locked four-section structure (HOR-242):
//   Insights — Stream, Market
//   Data     — Contacts, Properties
//   Events   — Inspections
//   Account  — Settings, Support
//
// "Stream" is the renamed Digest surface (wave icon, latest designs). The
// route stays `/digest` — only the nav label + icon change. Lists was
// removed from primary nav as redundant; the /lists page is still reachable
// from the contact/property "add to list" affordances.
//
// Notifications is no longer a page. The bell-button in each page topbar
// opens the slide-over (desktop + mobile) — see `components/notifications/
// slide-over.tsx`. /notifications 404s post-M1.

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Insights',
    items: [
      { href: '/digest', label: 'Stream', icon: Waves  },
      { href: '/market', label: 'Market', icon: MapPin },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/contacts',   label: 'Contacts',   icon: Users    },
      { href: '/properties', label: 'Properties', icon: Building },
    ],
  },
  {
    label: 'Events',
    items: [
      // HOR-148: Doorstep agent surface. Label is "Inspections" —
      // forward-looking, covers open homes today and private inspections
      // in v2 without a rename. Prospect-facing copy on /i/<token> stays
      // "open home" because that's the specific event they attend.
      { href: '/inspections', label: 'Inspections', icon: DoorOpen },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings   },
      { href: '/support',  label: 'Support',  icon: HelpCircle },
    ],
  },
]

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  orgName: string
  agentFirstName?: string | null
  agentLastName?: string | null
  avatarUrl?: string | null
  trialDaysLeft?: number | null
}

const EXPANDED_WIDTH = 220
const COLLAPSED_WIDTH = 64

export function Sidebar({
  orgName,
  agentFirstName,
  agentLastName,
  avatarUrl,
  trialDaysLeft = null,
}: SidebarProps) {
  const pathname = usePathname()
  const [pinnedCollapsed, toggle] = useSidebarPref()
  const [hovered, setHovered] = useState(false)

  // Effective visual state. When the rail is pinned collapsed, hovering
  // "peeks" it open (Claude-style) without reflowing the page — the layout
  // slot keeps the pinned width while the <aside> overlays the content.
  const collapsed = pinnedCollapsed && !hovered
  const peeking = pinnedCollapsed && hovered
  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
  const slotWidth = pinnedCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH

  const initials =
    [agentFirstName?.[0], agentLastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [agentFirstName, agentLastName].filter(Boolean).join(' ') || orgName

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  // Double-click anywhere on the sidebar chrome toggles the pinned state.
  // Ignore double-clicks that land on a nav link or button so the first
  // click's navigation / action isn't undone by an accidental toggle.
  function handleDoubleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('a, button')) return
    toggle()
  }

  return (
    <div
      style={{
        width: `${slotWidth}px`,
        minWidth: `${slotWidth}px`,
        transition: 'width 280ms var(--ease-out), min-width 280ms var(--ease-out)',
        position: 'relative',
      }}
      className="h-full"
    >
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={handleDoubleClick}
      style={{
        background: '#2E2823',
        width: `${width}px`,
        minWidth: `${width}px`,
        transition: 'width 280ms var(--ease-out), min-width 280ms var(--ease-out), box-shadow 200ms',
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 30,
        boxShadow: peeking ? '6px 0 28px rgba(0,0,0,0.28)' : 'none',
        userSelect: 'none',
      }}
      className="h-full flex flex-col overflow-hidden"
    >
      {/* ── Wordmark + collapse toggle ── */}
      <div
        className="flex items-center shrink-0"
        style={{
          gap: 10,
          padding: collapsed ? '20px 0 22px' : '20px 12px 22px 20px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <div
          className="rounded-full shrink-0"
          style={{ width: '9px', height: '9px', background: '#C4622D' }}
        />
        {!collapsed && (
          <span
            className="font-display font-semibold"
            style={{ fontSize: '20px', color: '#FAF7F2', letterSpacing: '-0.01em' }}
          >
            Horace
          </span>
        )}
        {/* Toggle — revealed on hover (fades in), like Claude's sidebar.
            Single click pins/unpins; double-click on the chrome does too. */}
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label={pinnedCollapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            title={pinnedCollapsed ? 'Pin open' : 'Collapse'}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C4622D]"
            style={{
              marginLeft: 'auto',
              width: 26,
              height: 26,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'rgba(245,240,232,0.5)',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 160ms var(--ease-out), color 160ms, background 160ms',
            }}
          >
            {pinnedCollapsed ? (
              <PanelLeftOpen style={{ width: 16, height: 16 }} aria-hidden />
            ) : (
              <PanelLeftClose style={{ width: 16, height: 16 }} aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: 8 }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.label} style={{ marginTop: si === 0 ? 0 : 14 }}>
            {/* Expanded: section heading. Collapsed: a tiny divider above each
                section after the first, so the grouping is still legible. */}
            {!collapsed && <SectionLabel>{section.label}</SectionLabel>}
            {collapsed && si > 0 && (
              <div
                style={{
                  height: 1,
                  margin: '12px 16px',
                  background: 'rgba(245,240,232,0.08)',
                }}
              />
            )}
            {section.items.map(({ href, label, icon }) => (
              <NavLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={isActive(href)}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* ── Profile block ── */}
      <div
        style={{
          borderTop: '1px solid rgba(245,240,232,0.08)',
          padding: collapsed ? '10px 0' : '10px 8px',
        }}
      >
        <Link
          href="/settings/profile"
          style={{
            textDecoration: 'none',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px 0' : '10px 16px',
          }}
          className="flex items-center gap-2.5 rounded transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C4622D] focus-visible:ring-offset-0"
          aria-label={`${fullName} — open profile settings`}
          title={collapsed ? fullName : undefined}
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

          {/* Name + trial countdown — hidden when collapsed */}
          {!collapsed && (
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
                {trialDaysLeft != null
                  ? `Trial · ${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left`
                  : orgName}
              </p>
            </div>
          )}
        </Link>
      </div>
    </aside>
    </div>
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
        letterSpacing: '0.12em',
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
  collapsed,
}: {
  href: string
  label: string
  icon: React.ElementType
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2.5 text-[13px]',
        active ? 'font-medium' : 'font-normal hover:bg-white/[0.06]',
      )}
      style={{
        padding: collapsed ? '10px 0' : '9px 20px',
        margin: collapsed ? '0 8px' : 0,
        borderRadius: collapsed ? 8 : 0,
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: active ? '#FAF7F2' : 'rgba(245,240,232,0.55)',
        background: active ? 'rgba(196,98,45,0.18)' : undefined,
        transition: 'background 180ms var(--ease-out), color 180ms',
        textDecoration: 'none',
      }}
    >
      <Icon
        className="shrink-0"
        style={{ width: '16px', height: '16px', color: active ? '#C4622D' : undefined }}
      />
      {!collapsed && <span className="flex-1">{label}</span>}
    </Link>
  )
}
