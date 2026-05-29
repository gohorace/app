'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Building2, Camera, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { InstallPrompt } from './install-prompt'

interface ProfileSettingsProps {
  agentId: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  avatarUrl: string | null
  workspaceName: string
  /** Accepted for call-site compatibility; nav gating now lives in the shell. */
  seatType?: 'agent' | 'support'
}

// HOR-329: the grouped settings nav moved to the persistent shell
// (components/settings/settings-nav.tsx + the /settings layout). This
// component is now just the Profile section content.
export function ProfileSettings({
  agentId,
  firstName,
  lastName,
  email,
  avatarUrl,
  workspaceName,
}: ProfileSettingsProps) {
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
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (uploadErr) throw uploadErr

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(path)

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
      <div
        style={{
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: '12px',
          padding: '20px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}
      >
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
            <span
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: '#FAF7F2',
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em',
              }}
            >
              {initials}
            </span>
          )}
          {uploading ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                background: 'rgba(26,22,18,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Loader2
                style={{ width: '18px', height: '18px', color: '#FAF7F2' }}
                className="animate-spin"
              />
            </div>
          ) : (
            <div
              style={{
                position: 'absolute',
                right: '-2px',
                bottom: '-2px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: '#1A1612',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #FAF7F2',
              }}
            >
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
          {email && <p style={{ fontSize: '12px', color: '#8C7B6B', marginTop: '2px' }}>{email}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px' }}>
            <Building2 style={{ width: '11px', height: '11px', color: '#8C7B6B' }} />
            <span style={{ fontSize: '11px', color: '#8C7B6B' }}>{workspaceName}</span>
          </div>
          {uploadError && (
            <p style={{ fontSize: '11px', color: '#C4622D', marginTop: '4px' }}>{uploadError}</p>
          )}
        </div>
      </div>

      {/* HOR-250: data-sovereignty strip — trust commitment, verbatim. */}
      <div
        style={{
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
          Your relationships, your history. The signal is shared with Horace — your view of it is
          sovereign.
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

      {/* Sign out (mobile path — desktop rail has its own) */}
      <button
        onClick={signOut}
        className="md:hidden"
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
        }}
      >
        <LogOut style={{ width: '15px', height: '15px' }} />
        Sign out
      </button>
    </div>
  )
}
