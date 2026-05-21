'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Bell, Code, BarChart2, Key, LogOut, Building2, Link2, Inbox, MapPin, Users, Camera, Loader2, Upload, LifeBuoy, Globe, CreditCard, Plug, ShieldOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { InstallPrompt } from './install-prompt'

interface ProfileSettingsProps {
  agentId: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  avatarUrl: string | null
  workspaceName: string
  /** HOR-203: support seats see a reduced nav (no Team / Billing). */
  seatType?: 'agent' | 'support'
}

// HOR-250: v2 regroups the flat settings nav into five labelled sections.
// User feedback during design moved Core markets + Portal address out of
// Doorstep and into Signals & alerts — honoured here.
interface NavItem {
  href: string
  label: string
  icon: typeof Users
  desc: string
}
interface NavSection {
  label: string
  /** Optional sub-label under the section header (Doorstep gets one). */
  blurb?: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/settings/team',    label: 'Team',           icon: Users,      desc: 'Invite teammates, manage roles' },
      { href: '/settings/billing', label: 'Plan & billing', icon: CreditCard, desc: 'Your plan, card on file, invoices' },
    ],
  },
  {
    label: 'Doorstep',
    blurb: 'Doorstep is the public sign-in surface — the page visitors land on after scanning your inspection QR.',
    items: [
      { href: '/settings/custom-domain', label: 'Custom domain',  icon: Globe, desc: 'Where Doorstep runs — your branded URL' },
      { href: '/settings/embed',         label: 'Website embed',   icon: Code,  desc: 'A sign-in form for your own website' },
    ],
  },
  {
    label: 'Signals & alerts',
    items: [
      { href: '/settings/notifications', label: 'Alerts & briefing', icon: Bell,      desc: 'Push notifications, daily email' },
      { href: '/settings/core-markets',  label: 'Core markets',      icon: MapPin,    desc: 'Suburbs in your patch — up to three' },
      { href: '/settings/portal',        label: 'Portal address',    icon: Inbox,     desc: 'Your inbound email for REA / Domain enquiries' },
      { href: '/settings/scoring',       label: 'Scoring rules',     icon: BarChart2, desc: 'How intent points are awarded' },
      { href: '/settings/tracked-links', label: 'Tracked links',     icon: Link2,     desc: 'Per-contact links + default destination' },
      { href: '/settings/snippet',       label: 'Install snippet',   icon: Code,      desc: 'Website tracking code' },
    ],
  },
  {
    label: 'Data & integrations',
    items: [
      { href: '/settings/integrations',     label: 'Integrations',     icon: Plug,     desc: 'Connect Gmail and other services' },
      { href: '/settings/email-exclusions', label: 'Email exclusions', icon: ShieldOff, desc: 'Recipients you never want Horace to email' },
      { href: '/settings/api-tokens',       label: 'API tokens',       icon: Key,      desc: 'Tokens for MCP clients (e.g. Claude)' },
      { href: '/import',                    label: 'Import contacts',  icon: Upload,   desc: 'Bring contacts in from a CSV' },
    ],
  },
  {
    label: 'Help',
    items: [
      { href: '/help', label: 'Help & guides', icon: LifeBuoy, desc: 'Walkthroughs and answers' },
    ],
  },
]

// Support seats don't manage the workspace — Team and Billing are
// hidden from their nav (and gated server-side at the page level).
const NAV_ITEMS_HIDDEN_FOR_SUPPORT = new Set<string>([
  '/settings/team',
  '/settings/billing',
])

// HOR-285 parked 2026-05-22: the website embed needs more product thought
// before it's exposed to agents. Gated OFF by default — the code and the
// /settings/embed page stay intact; only the entry point hides. Set
// NEXT_PUBLIC_EMBED_ENABLED=true to bring it back.
const EMBED_ENABLED = process.env.NEXT_PUBLIC_EMBED_ENABLED === 'true'

export function ProfileSettings({ agentId, firstName, lastName, email, avatarUrl, workspaceName, seatType = 'agent' }: ProfileSettingsProps) {
  const navSections: NavSection[] = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!EMBED_ENABLED && item.href === '/settings/embed') return false
      if (seatType === 'support' && NAV_ITEMS_HIDDEN_FOR_SUPPORT.has(item.href)) return false
      return true
    }),
  })).filter((section) => section.items.length > 0)
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Your profile'

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !agentId) return

    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.')
      return
    }

    setUploadError(null)
    setUploading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

      const { data: updated, error: updateErr } = await supabase
        .from('agents')
        .update({ avatar_url: publicUrl })
        .eq('id', agentId)
        .select()
      if (updateErr) throw updateErr
      if (!updated || updated.length === 0) throw new Error('Update blocked — please retry')

      router.refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
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
        {/* Avatar (click to upload) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !agentId}
          aria-label="Change profile photo"
          style={{
            position: 'relative',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: avatarUrl ? '#FAF7F2' : '#C4622D',
            backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: 'none',
            padding: 0,
            cursor: agentId && !uploading ? 'pointer' : 'default',
          }}
        >
          {!avatarUrl && !uploading && (
            <span style={{
              fontSize: '18px',
              fontWeight: 600,
              color: '#FAF7F2',
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.01em',
            }}>
              {initials}
            </span>
          )}
          {uploading ? (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(26,22,18,0.5)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Loader2 style={{ width: '18px', height: '18px', color: '#FAF7F2' }} className="animate-spin" />
            </div>
          ) : (
            <div style={{
              position: 'absolute', right: '-2px', bottom: '-2px',
              width: '20px', height: '20px', borderRadius: '50%',
              background: '#1A1612', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              border: '2px solid #FAF7F2',
            }}>
              <Camera style={{ width: '10px', height: '10px', color: '#FAF7F2' }} />
            </div>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          style={{ display: 'none' }}
        />

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
          {uploadError && (
            <p style={{ fontSize: '11px', color: '#C4622D', marginTop: '4px' }}>
              {uploadError}
            </p>
          )}
        </div>
      </div>

      {/* Settings nav — grouped into v2 sections (HOR-250) */}
      {navSections.map((section) => (
        <div key={section.label} style={{ marginBottom: '18px' }}>
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#1A1612',
              letterSpacing: '-0.01em',
            }}
          >
            {section.label}
          </h2>
          {section.blurb && (
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#8C7B6B', lineHeight: 1.5, maxWidth: 560 }}>
              {section.blurb}
            </p>
          )}
          <div style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {section.items.map(({ href, label, icon: Icon, desc }, i) => (
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
        </div>
      ))}

      {/* HOR-250: data-sovereignty strip — trust commitment, verbatim. */}
      <div
        style={{
          marginBottom: '18px',
          padding: '20px 22px',
          background: '#2E2823',
          color: '#F5F0E8',
          borderRadius: '12px',
        }}
      >
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(245,240,232,0.55)',
            marginBottom: '10px',
          }}
        >
          Your data
        </div>
        <p
          className="font-display"
          style={{
            margin: 0,
            fontStyle: 'italic',
            fontSize: '18px',
            lineHeight: 1.55,
            color: 'rgba(245,240,232,0.95)',
            letterSpacing: '-0.005em',
            maxWidth: 660,
          }}
        >
          Your relationships, your history. The signal is shared with Horace — your view of it is sovereign.
        </p>
        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            fontSize: '12px',
            color: 'rgba(245,240,232,0.75)',
          }}
        >
          <span>· Export everything as CSV, anytime.</span>
          <span>· Australian-hosted infrastructure.</span>
          <span>· Your book leaves with you if you ever go.</span>
        </div>
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
