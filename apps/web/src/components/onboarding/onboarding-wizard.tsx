'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep } from '@/lib/onboarding/state'
import { Rail, type RailStepId } from './rail'
import { StepScript } from './step-script'
import { StepContacts } from './step-contacts'
import { StepNotify } from './step-notify'
import { StepPair } from './step-pair'
import { StepReveal } from './step-reveal'
import styles from './onboarding.module.css'

type WizardStep = 'script' | 'contacts' | 'notify' | 'pair' | 'done'

const STAGE_COPY: Record<Exclude<WizardStep, 'done'>, { title: string; body: string }> = {
  script: {
    title: 'One line. Then Horace listens.',
    body: 'Paste a small snippet on your site — or send it to your developer. The moment it lands, Horace starts reading visitor behaviour.',
  },
  contacts: {
    title: 'Names you already know.',
    body: 'Bring in your address book. The instant a known name lands on your site, Horace tells you — no guesswork.',
  },
  notify: {
    title: 'A whisper, never a shout.',
    body: 'Browser alerts only when a signal is genuinely worth your attention. Two or three a week, max.',
  },
  pair: {
    title: 'Take Horace with you.',
    body: "You'll catch most signals on the move. The phone in your pocket is where this earns its keep.",
  },
}

interface Props {
  agentId: string
  snippetKey: string
  appUrl: string
  firstName: string | null
  lastCompletedStep: OnboardingStep | null
}

function resumeStep(last: OnboardingStep | null): WizardStep {
  if (!last || last === 'profile') return 'script'
  if (last === 'done') return 'done'
  if (last === 'script') return 'contacts'
  if (last === 'contacts') return 'notify'
  if (last === 'notify') return 'pair'
  if (last === 'pair') return 'done'
  return 'script'
}

export function OnboardingWizard({
  agentId: _agentId,
  snippetKey,
  appUrl,
  firstName,
  lastCompletedStep,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(resumeStep(lastCompletedStep))
  // Profile is always done by the time the post-auth wizard renders (signup
  // captured it before the magic-link click). Rail uses RailStepId, which
  // includes profile, so we track completed steps in that namespace.
  const [completed, setCompleted] = useState<Set<RailStepId>>(() => {
    const s = new Set<RailStepId>(['profile'])
    if (lastCompletedStep === 'script' || lastCompletedStep === 'contacts' || lastCompletedStep === 'notify' || lastCompletedStep === 'pair' || lastCompletedStep === 'done') s.add('script')
    if (lastCompletedStep === 'contacts' || lastCompletedStep === 'notify' || lastCompletedStep === 'pair' || lastCompletedStep === 'done') s.add('contacts')
    if (lastCompletedStep === 'notify' || lastCompletedStep === 'pair' || lastCompletedStep === 'done') s.add('notify')
    if (lastCompletedStep === 'pair' || lastCompletedStep === 'done') s.add('pair')
    return s
  })

  const advance = useCallback(async (current: Exclude<WizardStep, 'done'>, next: WizardStep) => {
    await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: current }),
    })
    setCompleted((prev) => {
      const s = new Set(prev)
      s.add(current as RailStepId)
      return s
    })
    setStep(next)
  }, [])

  const finish = useCallback(async () => {
    await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'done' }),
    })
    router.push('/dashboard')
  }, [router])

  if (step === 'done') {
    // Reveal is full-screen per the design — no rail, no shell.
    return (
      <main id="onboarding-main" className={styles.fullPane} aria-label="Reveal">
        <StepReveal firstName={firstName} onFinish={finish} />
      </main>
    )
  }

  return (
    <div className={styles.shell}>
      <Rail current={step as RailStepId} completed={completed} stage={STAGE_COPY[step]} />

      <main id="onboarding-main" className={styles.pane} aria-label="Onboarding">
        {step === 'script' && (
          <StepScript
            snippetKey={snippetKey}
            appUrl={appUrl}
            firstName={firstName}
            stepNumber={2}
            totalSteps={5}
            onNext={() => advance('script', 'contacts')}
          />
        )}

        {step === 'contacts' && (
          <StepContacts
            stepNumber={3}
            totalSteps={5}
            onNext={() => advance('contacts', 'notify')}
            onBack={() => setStep('script')}
          />
        )}

        {step === 'notify' && (
          <StepNotify
            stepNumber={4}
            totalSteps={5}
            onNext={() => advance('notify', 'pair')}
            onBack={() => setStep('contacts')}
          />
        )}

        {step === 'pair' && (
          <StepPair
            stepNumber={5}
            totalSteps={5}
            onNext={() => advance('pair', 'done')}
            onBack={() => setStep('notify')}
          />
        )}
      </main>
    </div>
  )
}
