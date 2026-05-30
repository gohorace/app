'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Building2, Camera, Loader2, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { SectionHeading } from '@/components/ui/section-heading'
import { InstallPrompt } from './install-prompt'

interface ProfileSettingsProps {
  agentId: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  avatarUrl: string | null
  phone: string | null
  timezone: string | null
  workspaceName: string
  /** HOR-203: support seats see a Support badge; agent seats see Agent. */
  seatType?: 'agent' | 'support'
}

// AU timezones — stored as IANA strings in agents.timezone.
const TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST, no DST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACDT/ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST, no DST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEDT/AEST)' },
]

// HOR-329: the grouped settings nav lives in the persistent shell
// (components/settings/settings-nav.tsx + the /settings layout). This
// component is the Profile section content — an editable identity form
// (name / mobile / time zone) plus the avatar, sovereignty strip, and
// install prompt. Email is read-only (it's the auth identity).
export function ProfileSettings({
  agentId,
  firstName,
  lastName,
  email,
  avatarUrl,
  phone,
  timezone,
  workspaceName,
  seatType = 'agent',
}: ProfileSettingsProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Editable identity fields.
  const [first, setFirst] = useState(firstName ?? '')
  const [last, setLast] = useState(lastName ?? '')
  const [mobile, setMobile] = useState(phone ?? '')
  const [tz, setTz] = useState(timezone ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dirty =
    first !== (firstName ?? '') ||
    last !== (lastName ?? '') ||
    mobile !== (phone ?? '') ||
    tz !== (timezone ?? '')

  const initials = [first?.[0], last?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const fullName = [first, last].filter(Boolean).join(' ') || 'Your profile'

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function reset() {
    setFirst(firstName ?? '')
    setLast(lastName ?? '')
    setMobile(phone ?? '')
    setTz(timezone ?? '')
    setSaveError(null)
  }

  async function save() {
    if (!agentId || !dirty) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      // Identity fields live on agents (client update — same RLS path the
      // avatar upload uses). Time zone is canonical on agent_settings, so it
      // goes through the notifications endpoint that already owns that column.
      const identityChanged =
        first !== (firstName ?? '') || last !== (lastName ?? '') || mobile !== (phone ?? '')
      const tzChanged = tz !== (timezone ?? '')

      if (identityChanged) {
        const supabase = createClient()
        const { error } = await supabase
          .from('agents')
          .update({
            first_name: first.trim() || null,
            last_name: last.trim() || null,
            phone: mobile.trim() || null,
          })
          .eq('id', agentId)
        if (error) throw error
      }

      if (tzChanged && tz) {
        const res = await fetch('/api/settings/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone: tz }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'Failed to save time zone')
        }
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
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
    <div className="p-4 md:p-8 space-y-5 max-w-[660px]">
      <SectionHeading
        title="Your profile"
        description="How you appear to your team and how Horace reaches you."
      />

      {/* Identity card */}
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
        <div className="mb-[22px] flex items-center gap-4">
          {/* Avatar (click to upload) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !agentId}
            aria-label="Change profile photo"
            className="relative size-[52px] shrink-0 rounded-full"
            style={{
              background: avatarUrl ? 'var(--bg-surface)' : 'var(--color-terracotta)',
              backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              cursor: agentId && !uploading ? 'pointer' : 'default',
            }}
          >
            {!avatarUrl && !uploading && (
              <span className="absolute inset-0 flex items-center justify-center font-serif text-lg font-semibold text-[var(--color-cream)]">
                {initials}
              </span>
            )}
            {uploading ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                <Loader2 className="size-[18px] animate-spin text-[var(--color-cream)]" />
              </span>
            ) : (
              <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-[var(--bg-surface)] bg-[var(--color-ink)]">
                <Camera className="size-2.5 text-[var(--color-cream)]" />
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />

          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--fg-primary)]">{fullName}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--fg-secondary)]">
              <Building2 className="size-3" />
              {workspaceName}
            </div>
            {uploadError && (
              <p className="mt-1 text-xs text-[var(--color-terracotta)]">{uploadError}</p>
            )}
          </div>
          <Badge variant={seatType === 'agent' ? 'accent' : 'moss'} dot>
            {seatType === 'agent' ? 'Agent' : 'Support'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="first-name">First name</Label>
            <Input id="first-name" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last-name">Last name</Label>
            <Input id="last-name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email ?? ''} disabled />
            <p className="text-xs text-[var(--fg-tertiary)]">
              Your sign-in email — contact support to change it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobile">Mobile</Label>
            <Input
              id="mobile"
              type="tel"
              inputMode="tel"
              placeholder="0412 345 678"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Time zone</Label>
            <Select
              id="timezone"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              options={[{ value: '', label: 'Select…' }, ...TIMEZONES]}
            />
          </div>
        </div>

        {saveError && <p className="mt-3 text-sm text-[var(--color-terracotta)]">{saveError}</p>}

        <div className="mt-5 flex items-center justify-end gap-2.5">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-moss)]">
              <Check className="size-3.5" />
              Saved
            </span>
          )}
          {dirty && (
            <Button variant="ghost" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button onClick={save} disabled={!dirty || saving || !agentId}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      {/* HOR-250: data-sovereignty strip — trust commitment, verbatim. */}
      <div className="rounded-lg bg-[var(--color-charcoal)] p-[22px] text-[var(--color-cream)]">
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgba(245,240,232,0.55)]">
          Your data
        </div>
        <p className="m-0 max-w-[600px] font-serif text-lg italic leading-relaxed text-[rgba(245,240,232,0.95)]">
          Your relationships, your history. The signal is shared with Horace — your view of it is
          sovereign.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-[rgba(245,240,232,0.75)]">
          <span>· Export everything as CSV, anytime.</span>
          <span>· Australian-hosted infrastructure.</span>
          <span>· Your book leaves with you if you ever go.</span>
        </div>
      </div>

      {/* Add to home screen */}
      <InstallPrompt />

      {/* Sign out (mobile path — desktop rail has its own) */}
      <Button
        variant="secondary"
        onClick={signOut}
        className="w-full justify-start gap-2.5 md:hidden"
      >
        <LogOut className="size-[15px]" />
        Sign out
      </Button>
    </div>
  )
}
