'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep } from '@/lib/onboarding/state'
import { Rail } from './rail'
import { StepScript } from './step-script'
import { StepContacts } from './step-contacts'
import { StepNotify } from './step-notify'
import { StepReveal } from './step-reveal'
import styles from './onboarding.module.css'

type WizardStep = Exclude<OnboardingStep, 'profile'>

const STAGE_COPY: Record<WizardStep, { title: string; body: string }> = {
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
  done: {
    title: 'You’re live.',
    body: 'Sample signals show what Horace looks like when it’s humming. The first real visit lights up the moment it lands.',
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
  if (last === 'notify') return 'done'
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
  const [completed, setCompleted] = useState<Set<WizardStep>>(() => {
    const s = new Set<WizardStep>()
    if (lastCompletedStep === 'script' || lastCompletedStep === 'contacts' || lastCompletedStep === 'notify' || lastCompletedStep === 'done') s.add('script')
    if (lastCompletedStep === 'contacts' || lastCompletedStep === 'notify' || lastCompletedStep === 'done') s.add('contacts')
    if (lastCompletedStep === 'notify' || lastCompletedStep === 'done') s.add('notify')
    if (lastCompletedStep === 'done') s.add('done')
    return s
  })

  const advance = useCallback(async (current: WizardStep, next: WizardStep) => {
    await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: current }),
    })
    setCompleted((prev) => new Set(prev).add(current))
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

  return (
    <div className={styles.shell}>
      <Rail current={step} completed={completed} stage={STAGE_COPY[step]} />

      <main id="onboarding-main" className={styles.pane} aria-label="Onboarding">
        {step === 'script' && (
          <StepScript
            snippetKey={snippetKey}
            appUrl={appUrl}
            firstName={firstName}
            stepNumber={1}
            totalSteps={4}
            onNext={() => advance('script', 'contacts')}
          />
        )}

        {step === 'contacts' && (
          <StepContacts
            stepNumber={2}
            totalSteps={4}
            onNext={() => advance('contacts', 'notify')}
            onBack={() => setStep('script')}
          />
        )}

        {step === 'notify' && (
          <StepNotify
            stepNumber={3}
            totalSteps={4}
            onNext={() => advance('notify', 'done')}
            onBack={() => setStep('contacts')}
          />
        )}

        {step === 'done' && (
          <StepReveal
            firstName={firstName}
            onFinish={finish}
          />
        )}
      </main>
    </div>
  )
}
