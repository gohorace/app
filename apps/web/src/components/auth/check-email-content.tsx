'use client'

import { useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'

export function CheckEmailContent() {
  const params = useSearchParams()
  const email = params.get('email')

  return (
    <Card>
      <CardContent className="pt-6 space-y-3 text-sm text-muted-foreground">
        <p>
          We sent a sign-in link to{' '}
          <span className="font-medium text-foreground">{email ?? 'your inbox'}</span>.
        </p>
        <p>The link expires in 10 minutes and can only be used once.</p>
      </CardContent>
    </Card>
  )
}
