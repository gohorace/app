'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Bell, Code, BarChart2, Key, LogOut, Building2, Link2, Inbox, Users, Camera, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { InstallPrompt } from './install-prompt'

interface ProfileSettingsProps {
  agentId: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  avatarUrl: string | null
  workspaceName: string
}

const NAV_ITEMS = [
  { href: '/settings/team',           label: 'Team',               icon: Users,     desc: 'Invite teammates, manage roles' },
  { href: '/settings/notifications',  label: 'Alerts & briefing',  icon: Bell,      desc: 'Push notifications, daily email' },
  { href: '/settings/portal',         label: 'Portal address',     icon: Inbox,     desc: 'Your inbound email for REA / Domain enquiries' },
  { href: '/settings/tracked-links',  label: 'Tracked links',      icon: Link2,     desc: 'Per-contact links + default destination' },
  { href: '/settings/snippet',        label: 'Install snippet',    icon: Code,      desc: 'Website tracking code' },
  { href: '/settings/scoring',        label: 'Scoring rules',      icon: BarChart2, desc: 'How intent points are awarded' },
  { href: '/settings/api-tokens',     label: 'API & integrations', icon: Key,       desc: 'Tokens for MCP and outreach' },
]

export function ProfileSettings({ agentId, firstName, lastName, email, avatarUrl, workspaceName }: ProfileSettingsProps) {
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
    console.log('[avatar] handleFile fired', { hasFile: !!file, agentId, fileName: file?.name, size: file?.size, type: file?.type })
    if (!file || !agentId) {
      console.warn('[avatar] aborting: no file or no agentId')
      return
    }

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
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      console.log('[avatar] getUser', { userId: user?.id, userErr })
      if (!user) throw new Error('Not signed in')

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`
      console.log('[avatar] uploading to', path)

      const uploadResult = await supabase.storage
        .from('avatars')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      console.log('[avatar] upload result', uploadResult)
      if (uploadResult.error) throw uploadResult.error

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      console.log('[avatar] publicUrl', publicUrl)

      const updateResult = await supabase
        .from('agents')
        .update({ avatar_url: publicUrl })
        .eq('id', agentId)
        .select()
      console.log('[avatar] agents.update result', updateResult)
      if (updateResult.error) throw updateResult.error
      if (!updateResult.data || updateResult.data.length === 0) {
        throw new Error('Update returned 0 rows — likely RLS blocked it')
      }

      router.refresh()
    } catch (err) {
      console.error('[avatar] upload failed', err)
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      setUploadError(msg)
      alert('Avatar upload failed: ' + msg)
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
