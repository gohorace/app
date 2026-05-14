import { createAdminClient } from '@/lib/supabase/admin'

export type OnboardingStep = 'profile' | 'script' | 'contacts' | 'notify' | 'pair' | 'done'

export const STEPS: OnboardingStep[] = ['profile', 'script', 'contacts', 'notify', 'pair', 'done']

const NEXT_STEP: Record<OnboardingStep, OnboardingStep | null> = {
  profile: 'script',
  script: 'contacts',
  contacts: 'notify',
  notify: 'pair',
  pair: 'done',
  done: null,
}

export function nextStep(current: OnboardingStep): OnboardingStep | null {
  return NEXT_STEP[current]
}

/**
 * Resolve the step the agent should land on, given what they last completed.
 * NULL or 'profile' → 'script' (profile is captured at signup, before any
 * authenticated session, so the post-auth wizard always starts at 'script').
 */
export function resumeStep(lastCompleted: OnboardingStep | null): OnboardingStep {
  if (!lastCompleted || lastCompleted === 'profile') return 'script'
  return NEXT_STEP[lastCompleted] ?? 'done'
}

export async function markStepComplete(agentId: string, step: OnboardingStep) {
  const admin = createAdminClient()
  const { error } = await admin
    .from('agents')
    .update({ last_completed_step: step })
    .eq('id', agentId)
  if (error) throw error
}
