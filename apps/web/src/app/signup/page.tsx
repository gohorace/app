import { Suspense } from 'react'
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
        </main>
      </div>
    </>
  )
}
