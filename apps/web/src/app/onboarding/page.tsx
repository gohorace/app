import { redirect } from 'next/navigation'
import { bootstrapOnboardingContext } from '@/lib/onboarding/bootstrap'

/**
 * Chooser. Decides whether the agent sees the conversational v2 shell
 * (/onboarding/agentic) or the classic 6-step wizard (/onboarding/classic).
 *
 * Decision order:
 *   1. ?flow=classic|agentic query string (used by the persistent bail
 *      link, and for debugging deep links).
 *   2. agents.onboarding_flow column (defaults to 'agentic' for new
 *      agents — migration 20260518000020).
 *
 * Bootstrap (workspace creation, heal-forward, snippet fetch) is shared
 * with the child routes via lib/onboarding/bootstrap.ts. Calling it here
 * means the child route's call becomes an idempotent re-read — this is
 * intentional: the chooser must know the agent's onboarding_flow, which
 * requires the agents row to exist, which requires bootstrap to run.
 */
export default async function OnboardingChooserPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string }>
}) {
  const ctx = await bootstrapOnboardingContext()
  const params = await searchParams
  const explicitFlow =
    params.flow === 'classic' || params.flow === 'agentic' ? params.flow : null
  const target = explicitFlow ?? ctx.onboardingFlow
  redirect(target === 'classic' ? '/onboarding/classic' : '/onboarding/agentic')
}
