import { Suspense } from 'react'
import Link from 'next/link'
import { CheckEmailContent } from '@/components/auth/check-email-content'

export default function CheckEmailPage() {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Sending the link…</p>}>
          <CheckEmailContent />
        </Suspense>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Wrong address?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Try again
        </Link>
      </p>
    </div>
  )
}
