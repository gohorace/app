import { AgenticShell } from '@/components/onboarding/agentic/agentic-shell'
import { bootstrapOnboardingContext } from '@/lib/onboarding/bootstrap'

/**
 * Conversational v2 onboarding shell. Default destination for new agents.
 * Resume is governed by the existing agents.last_completed_step column —
 * turn N in v2 maps 1:1 to step N in v1, so an agent who bails between
 * flows picks up exactly where they left off.
 *
 * PR 1 ships a stub shell with only Turn 0 wired. Bail link works; later
 * PRs flesh out the chat surface, reducer, and turns 1-7.
 */
export default async function OnboardingAgenticPage() {
  const ctx = await bootstrapOnboardingContext()
  return (
    <AgenticShell
      agentId={ctx.agentId}
      snippetKey={ctx.snippetKey}
      appUrl={ctx.appUrl}
      firstName={ctx.firstName}
    />
  )
}
