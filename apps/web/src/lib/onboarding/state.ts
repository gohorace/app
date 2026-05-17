import { createAdminClient } from '@/lib/supabase/admin'

// 'core_markets' added in HOR-194 between 'script' and 'contacts'.
// CHECK constraint widening lives in supabase/migrations/20260517000005.
export type OnboardingStep =
  | 'profile'
  | 'script'
  | 'core_markets'
  | 'contacts'
  | 'notify'
  | 'pair'
  | 'done'

export const STEPS: OnboardingStep[] = [
  'profile',
  'script',
  'core_markets',
  'contacts',
  'notify',
  'pair',
  'done',
]

const NEXT_STEP: Record<OnboardingStep, OnboardingStep | null> = {
  profile:      'script',
  script:       'core_markets',
  core_markets: 'contacts',
  contacts:     'notify',
  notify:       'pair',
  pair:         'done',
  done:         null,
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
    // database.types.ts lags HOR-194's CHECK constraint widening
    // (migration 20260517000005). Cast at the boundary until next
    // `supabase gen types` regen — same pattern as
    // notifications/push.ts:102 for the inspection alert types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ last_completed_step: step as any })
    .eq('id', agentId)
  if (error) throw error
}
