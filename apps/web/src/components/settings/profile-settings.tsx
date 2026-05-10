'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Bell, Code, BarChart2, Key, LogOut, Building2, Link2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { InstallPrompt } from './install-prompt'

interface ProfileSettingsProps {
  firstName: string | null
  lastName: string | null
  email: string | null
  workspaceName: string
}

const NAV_ITEMS = [
  { href: '/settings/notifications',  label: 'Alerts & briefing',  icon: Bell,      desc: 'Push notifications, daily email' },
  { href: '/settings/tracked-links',  label: 'Tracked links',      icon: Link2,     desc: 'Per-contact links + default destination' },
  { href: '/settings/snippet',        label: 'Install snippet',    icon: Code,      desc: 'Website tracking code' },
  { href: '/settings/scoring',        label: 'Scoring rules',      icon: BarChart2, desc: 'How intent points are awarded' },
  { href: '/settings/api-tokens',     label: 'API & integrations', icon: Key,       desc: 'Tokens for MCP and outreach' },
]

export function ProfileSettings({ firstName, lastName, email, workspaceName }: ProfileSettingsProps) {
  const router = useRouter()

  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Your profile'

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-lg">

      {/* Profile card */}
      <div style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: '12px',
        padding: '20px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      }}>
        {/* Avatar */}
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: '#C4622D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#FAF7F2',
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.01em',
          }}>
            {initials}
          </span>
        </div>

        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '16px', fontWeight: 600, color: '#1A1612', lineHeight: 1.2 }}>
            {fullName}
          </p>
          {email && (
            <p style={{ fontSize: '12px', color: '#8C7B6B', marginTop: '2px' }}>
              {email}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px' }}>
            <Building2 style={{ width: '11px', height: '11px', color: '#8C7B6B' }} />
            <span style={{ fontSize: '11px', color: '#8C7B6B' }}>{workspaceName}</span>
          </div>
        </div>
      </div>

      {/* Settings nav */}
      <div style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {NAV_ITEMS.map(({ href, label, icon: Icon, desc }, i) => (
          <Link
            key={href}
            href={href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 18px',
              textDecoration: 'none',
              borderTop: i === 0 ? 'none' : '1px solid rgba(140,123,107,0.12)',
              transition: 'background 150ms',
            }}
            className="settings-nav-row"
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(196,98,45,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon style={{ width: '15px', height: '15px', color: '#C4622D' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#1A1612', margin: 0 }}>
                {label}
              </p>
              <p style={{ fontSize: '11px', color: '#8C7B6B', margin: 0, marginTop: '1px' }}>
                {desc}
              </p>
            </div>
            <ChevronRight style={{ width: '16px', height: '16px', color: '#8C7B6B', flexShrink: 0 }} />
          </Link>
        ))}
      </div>

      {/* Add to home screen */}
      <InstallPrompt />

      {/* Sign out */}
      <button
        onClick={signOut}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '14px 18px',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: '12px',
          cursor: 'pointer',
          color: '#8C7B6B',
          fontSize: '13px',
          fontWeight: 500,
          textAlign: 'left',
          transition: 'background 150ms',
        }}
      >
        <LogOut style={{ width: '15px', height: '15px' }} />
        Sign out
      </button>
    </div>
  )
}
