/**
 * Persist the agent's preferred onboarding shell so a refresh of
 * /onboarding lands them on the same surface they bailed to.
 *
 * Fire-and-forget. Errors log but never block navigation — the bail
 * link should always take the agent where they're trying to go,
 * even if the writeback fails. The chooser will fall back to the
 * default 'agentic' on the next visit if the column wasn't updated;
 * worst-case the agent clicks bail twice.
 */
export function persistOnboardingFlow(flow: 'agentic' | 'classic'): void {
  // Use keepalive so the request survives the navigation away. fetch
  // with method:POST + keepalive:true is the documented pattern for
  // "fire this off but don't wait for it".
  try {
    void fetch('/api/agent/flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow }),
      keepalive: true,
    }).catch((err) => {
      console.error('[onboarding/agentic] persistOnboardingFlow failed', err)
    })
  } catch (err) {
    console.error('[onboarding/agentic] persistOnboardingFlow threw', err)
  }
}
