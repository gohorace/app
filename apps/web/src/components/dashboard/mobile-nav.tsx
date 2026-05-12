'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Users, Bell, Settings } from 'lucide-react'

const TABS = [
  { href: '/dashboard', label: 'Today',    icon: Home     },
  { href: '/leads',     label: 'Contacts', icon: Users    },
  { href: '/activity',  label: 'Activity', icon: Bell     },
  { href: '/settings',  label: 'Profile',  icon: Settings },
] as const

interface Props {
  unreadActivity?: number
}

export function MobileNav({ unreadActivity = 0 }: Props) {
  const pathname = usePathname()

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        background: 'rgba(26,22,18,0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '0.5px solid rgba(245,240,232,0.1)',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const isActive =
          href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(href)
        const showBadge = href === '/activity' && unreadActivity > 0

        return (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              padding: '10px 0 8px',
              textDecoration: 'none',
              color: isActive ? '#C4622D' : 'rgba(245,240,232,0.4)',
              transition: 'color 150ms',
            }}
          >
            <div style={{ position: 'relative', display: 'flex' }}>
              <Icon
                style={{
                  width: '22px',
                  height: '22px',
                  strokeWidth: 1.5,
                }}
              />
              {showBadge && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-6px',
                    minWidth: '14px',
                    height: '14px',
                    padding: '0 4px',
                    borderRadius: '9999px',
                    background: '#C4622D',
                    color: '#FAF7F2',
                    fontSize: '9px',
                    fontWeight: 700,
                    lineHeight: '14px',
                    textAlign: 'center',
                  }}
                >
                  {unreadActivity > 99 ? '99+' : unreadActivity}
                </span>
              )}
            </div>
            <span style={{
              fontSize: '10px',
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'var(--font-body)',
              letterSpacing: '0.02em',
            }}>
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
