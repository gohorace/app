import type { OnboardingStep } from '@/lib/onboarding/state'

/**
 * Client-side step-completion POST. The agentic turns call this when
 * the agent finishes a turn; the existing /api/onboarding/step route
 * persists last_completed_step (auth-checked server-side).
 *
 * Fire-and-forget. If the POST fails, the agent still advances —
 * losing one step marker is better than blocking the conversation,
 * and the heal-forward in bootstrapOnboardingContext will catch most
 * gaps on the next visit. Errors are logged for observability.
 */
export async function markStepComplete(step: OnboardingStep): Promise<void> {
  try {
    const res = await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    })
    if (!res.ok) {
      console.error('[onboarding/agentic] markStepComplete failed', step, res.status)
    }
  } catch (e) {
    console.error('[onboarding/agentic] markStepComplete threw', step, e)
  }
}
