'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'
  const initialError = searchParams.get('error_description') ?? searchParams.get('error')

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('redirectTo', redirectTo)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: false,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push(`/check-email?email=${encodeURIComponent(email)}`)
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <p className="text-xs text-muted-foreground">
            We’ll email you a one-time sign-in link. No password needed.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Sending link…' : 'Email me a sign-in link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
