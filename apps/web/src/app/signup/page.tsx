import { Suspense } from 'react'
import Link from 'next/link'
import { SignupForm } from '@/components/auth/signup-form'
import { Rail } from '@/components/onboarding/rail'
import styles from '@/components/onboarding/onboarding.module.css'

const PROFILE_STAGE = {
  title: 'Tell Horace who you are.',
  body: "We'll personalise every signal — and only ever email you when there's something worth a call.",
}

export default function SignupPage() {
  return (
    <>
      <a href="#signup-main" className="skip-link">Skip to main content</a>
      <div className={styles.shell}>
        <Rail current="profile" completed={new Set()} stage={PROFILE_STAGE} />
        <main id="signup-main" className={styles.pane} aria-label="Create your account">
          <div className={styles.paneMeta}>
            <span>About you</span>
            <span className={styles.paneMetaDivider} />
            <span>Step 1 of 4</span>
          </div>
          <h1 className={styles.paneTitle}>Let&apos;s start with the basics.</h1>
          <p className={styles.paneSub}>
            Horace personalises every signal for you and your agency. We won&apos;t share your details, ever.
          </p>

          <Suspense fallback={null}>
            <SignupForm />
          </Suspense>

          <p style={{
            fontSize: 13,
            color: 'var(--color-stone-aa)',
            marginTop: 32,
            paddingTop: 24,
            borderTop: '1px solid var(--border-subtle)',
          }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--color-terracotta-text)', fontWeight: 500, textDecoration: 'underline' }}>
              Sign in
            </Link>
          </p>
        </main>
      </div>
    </>
  )
}
