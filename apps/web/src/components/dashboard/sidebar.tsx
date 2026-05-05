'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Eye,
  Users,
  TrendingUp,
  Settings,
  LogOut,
  Key,
  Code,
  BarChart2,
  Bell,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
  badge?: number | null
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: 'Intelligence',
    items: [
      { href: '/dashboard', label: 'Signals',  icon: Eye,   badge: null },
      { href: '/leads',     label: 'Contacts', icon: Users, badge: null },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings/snippet',       label: 'Snippet install',   icon: Code },
      { href: '/settings/scoring',       label: 'Scoring rules',     icon: BarChart2 },
      { href: '/settings/notifications', label: 'Alerts & briefing', icon: Bell },
      { href: '/settings/api-tokens',    label: 'API tokens',        icon: Key },
    ],
  },
]

export function Sidebar({ orgName }: { orgName: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside
      style={{ background: '#2E2823', width: '220px', minWidth: '220px' }}
      className="h-full flex flex-col overflow-hidden"
    >
      {/* Wordmark */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-7">
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

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-0">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <p
              className="px-5 mb-1"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.3)',
                marginTop: '16px',
              }}
            >
              {group.label}
            </p>

            {group.items.map(({ href, label, icon: Icon, badge }) => {
              const active = isActive(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 px-5 py-2.5 text-[13px] transition-colors',
                    active
                      ? 'font-medium'
                      : 'font-normal hover:bg-white/[0.06]'
                  )}
                  style={{
                    color: active ? '#FAF7F2' : 'rgba(245,240,232,0.55)',
                    background: active ? 'rgba(196,98,45,0.18)' : undefined,
                    transitionDuration: '180ms',
                  }}
                >
                  <Icon
                    className="shrink-0"
                    style={{
                      width: '16px',
                      height: '16px',
                      color: active ? '#C4622D' : undefined,
                    }}
                  />
                  <span className="flex-1">{label}</span>
                  {badge != null && (
                    <span
                      className="font-semibold"
                      style={{
                        background: '#C4622D',
                        color: '#FAF7F2',
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '9999px',
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer — sign out */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderTop: '1px solid rgba(245,240,232,0.08)' }}
      >
        <div>
          <p style={{ fontSize: '12px', fontWeight: 500, color: 'rgba(245,240,232,0.75)' }}>
            {orgName}
          </p>
          <p style={{ fontSize: '10px', color: 'rgba(245,240,232,0.35)' }}>
            Principal agent
          </p>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="flex items-center justify-center transition-colors hover:opacity-70"
          style={{ color: 'rgba(245,240,232,0.35)', padding: '4px' }}
        >
          <LogOut style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    </aside>
  )
}
