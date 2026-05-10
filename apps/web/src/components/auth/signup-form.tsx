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
  const [name, setName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAlreadyAuthed(true)
    })
  }, [])

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

    // New signup: stash agency name + full name in user_metadata. The
    // /onboarding page consumes pending_agency_name to auto-create the
    // workspace once the user clicks the magic link and gets a session.
    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('redirectTo', redirectTo)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: {
          full_name: name,
          pending_agency_name: agencyName,
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
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                placeholder="Jane Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="agency">Agency / Business name</Label>
            <Input
              id="agency"
              placeholder="Smith Real Estate"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              required
            />
          </div>
          {!alreadyAuthed && (
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
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
                We’ll email you a sign-in link to confirm your address. No password needed.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
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
