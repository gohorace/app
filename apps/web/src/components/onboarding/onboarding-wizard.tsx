'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep } from '@/lib/onboarding/state'
import { Rail, type RailStepId } from './rail'
import { StepScript } from './step-script'
import { StepCoreMarkets } from './step-core-markets'
import { StepContacts } from './step-contacts'
import { StepNotify } from './step-notify'
import { StepPair } from './step-pair'
import { StepReveal } from './step-reveal'
import styles from './onboarding.module.css'

// 'core_markets' added between 'script' and 'contacts' in HOR-194.
// Total user-facing steps = 6 (script through pair, with reveal as 'done').
type WizardStep = 'script' | 'core_markets' | 'contacts' | 'notify' | 'pair' | 'done'

const STAGE_COPY: Record<Exclude<WizardStep, 'done'>, { title: string; body: string }> = {
  script: {
    title: 'One line. Then Horace listens.',
    body: 'Paste a small snippet on your site — or send it to your developer. The moment it lands, Horace starts reading visitor behaviour.',
  },
  core_markets: {
    title: 'Where you work.',
    body: 'Tell Horace which suburbs you cover. The whole patch comes in, ready to be matched against the names you already know.',
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

const TOTAL_STEPS = 6 // script, core_markets, contacts, notify, pair, reveal

interface Props {
  agentId: string
  snippetKey: string
  appUrl: string
  firstName: string | null
  lastCompletedStep: OnboardingStep | null
}

function resumeStep(last: OnboardingStep | null): WizardStep {
  if (!last || last === 'profile')   return 'script'
  if (last === 'done')               return 'done'
  if (last === 'script')             return 'core_markets'
  if (last === 'core_markets')       return 'contacts'
  if (last === 'contacts')           return 'notify'
  if (last === 'notify')             return 'pair'
  if (last === 'pair')               return 'done'
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
    // Step-precedence chain. last_completed_step at any non-NULL value
    // implies every prior step is done.
    const order: OnboardingStep[] = ['script', 'core_markets', 'contacts', 'notify', 'pair', 'done']
    const lastIdx = lastCompletedStep ? order.indexOf(lastCompletedStep) : -1
    if (lastIdx >= 0) {
      // Add every step at or below lastIdx (except 'done' which isn't a RailStepId).
      for (let i = 0; i <= lastIdx; i++) {
        const id = order[i]
        if (id !== 'done') s.add(id as RailStepId)
      }
    }
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
            totalSteps={TOTAL_STEPS}
            onNext={() => advance('script', 'core_markets')}
          />
        )}

        {step === 'core_markets' && (
          <StepCoreMarkets
            stepNumber={3}
            totalSteps={TOTAL_STEPS}
            onNext={() => advance('core_markets', 'contacts')}
            onBack={() => setStep('script')}
          />
        )}

        {step === 'contacts' && (
          <StepContacts
            stepNumber={4}
            totalSteps={TOTAL_STEPS}
            onNext={() => advance('contacts', 'notify')}
            onBack={() => setStep('core_markets')}
          />
        )}

        {step === 'notify' && (
          <StepNotify
            stepNumber={5}
            totalSteps={TOTAL_STEPS}
            onNext={() => advance('notify', 'pair')}
            onBack={() => setStep('contacts')}
          />
        )}

        {step === 'pair' && (
          <StepPair
            stepNumber={6}
            totalSteps={TOTAL_STEPS}
            onNext={() => advance('pair', 'done')}
            onBack={() => setStep('notify')}
          />
        )}
      </main>
    </div>
  )
}
