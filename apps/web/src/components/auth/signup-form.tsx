'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/onboarding'

  const [alreadyAuthed, setAlreadyAuthed] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAlreadyAuthed(true)
    })
  }, [])

  const ready = alreadyAuthed
    ? agencyName.trim().length > 0
    : firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      email.trim().length > 0 &&
      agencyName.trim().length > 0 &&
      mobile.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    if (alreadyAuthed) {
      // User already has a session — finish workspace setup directly.
      const { data } = await supabase.auth.getUser()
      const userEmail = data.user?.email ?? email

      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agencyName, email: userEmail }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to create organisation')
        setLoading(false)
        return
      }

      window.location.href = redirectTo
      return
    }

    // New signup: stash full profile in user_metadata. The /onboarding page
    // consumes pending_* keys to auto-create the workspace + agent once the
    // user clicks the magic link.
    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('redirectTo', redirectTo)

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: {
          full_name: fullName,
          pending_first_name: firstName.trim(),
          pending_last_name: lastName.trim(),
          pending_agency_name: agencyName.trim(),
          pending_mobile: mobile.trim(),
        },
        emailRedirectTo: callback.toString(),
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }

    router.push(`/check-email?email=${encodeURIComponent(email)}`)
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {!alreadyAuthed && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="agency">Agency name</Label>
            <Input
              id="agency"
              placeholder="Smith Real Estate"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              required
            />
          </div>
          {!alreadyAuthed && (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="agent@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">
                  We&apos;ll email you a sign-in link to confirm your address. No password needed.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile</Label>
                <Input
                  id="mobile"
                  type="tel"
                  placeholder="0412 345 678"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                  autoComplete="tel"
                />
                <p className="text-xs text-muted-foreground">
                  For push alerts when a signal is worth your attention.
                </p>
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !ready}>
            {loading
              ? 'Setting up…'
              : alreadyAuthed
                ? 'Create agency'
                : 'Email me a sign-in link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
