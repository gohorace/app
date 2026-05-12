'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Eye, Users, Inbox, MoreHorizontal } from 'lucide-react'

const TABS = [
  { href: '/dashboard', label: 'Signals',  icon: Eye             },
  { href: '/contacts',  label: 'Contacts', icon: Users           },
  { href: '/digest',    label: 'Digest',   icon: Inbox           },
  { href: '/settings',  label: 'More',     icon: MoreHorizontal  },
]

export function MobileNav() {
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
            <Icon
              style={{
                width: '22px',
                height: '22px',
                strokeWidth: 1.5,
              }}
            />
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
