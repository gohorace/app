import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { bootstrapOnboardingContext } from '@/lib/onboarding/bootstrap'

/**
 * Classic v1 wizard. Reachable directly, via /onboarding?flow=classic, or
 * via the persistent "Use the classic setup instead" link in the agentic
 * shell. Renders the existing OnboardingWizard verbatim — resume from
 * agents.last_completed_step works exactly as it did pre-v2, so anything
 * the agent committed in the agentic flow (snippet, core_markets, contacts,
 * push subscription, pairing) carries over with no extra contract.
 */
export default async function OnboardingClassicPage() {
  const ctx = await bootstrapOnboardingContext()
  return (
    <OnboardingWizard
      agentId={ctx.agentId}
      snippetKey={ctx.snippetKey}
      appUrl={ctx.appUrl}
      firstName={ctx.firstName}
      lastCompletedStep={ctx.lastCompletedStep}
    />
  )
}
