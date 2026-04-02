'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export function SignupForm() {
  const [alreadyAuthed, setAlreadyAuthed] = useState(false)
  const [name, setName] = useState('')
  const [agencyName, setAgencyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    let userEmail = email

    if (!alreadyAuthed) {
      // New user — create auth account first
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })

      if (signUpError || !authData.user) {
        setError(signUpError?.message ?? 'Sign up failed')
        setLoading(false)
        return
      }
    } else {
      // Already authenticated — just need their email for org settings
      const { data } = await supabase.auth.getUser()
      userEmail = data.user?.email ?? email
    }

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

    window.location.href = '/dashboard'
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
            <>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading
              ? 'Setting up...'
              : alreadyAuthed
                ? 'Create agency'
                : 'Create account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
