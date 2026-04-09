import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import Link from 'next/link'

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your Horace account</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
