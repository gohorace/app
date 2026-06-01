import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToSignupsChannel } from '@/lib/notifications/slack'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { redirect } from 'next/navigation'
import type { OnboardingStep } from './state'

/**
 * The context every onboarding surface (chooser, agentic shell, classic
 * wizard) needs. Returned by bootstrapOnboardingContext.
 */
export interface OnboardingContext {
  agentId: string
  workspaceId: string | null
  snippetKey: string
  appUrl: string
  firstName: string | null
  /** The agent's auth email. Used by Turn 2 to suggest "your site is
   *  reidproperty.com.au — that right?" pre-fill. May be empty if the
   *  Supabase user has no email (shouldn't happen via magic-link flow,
   *  but defensive default avoids a null check at every turn). */
  email: string
  lastCompletedStep: OnboardingStep | null
  onboardingFlow: 'agentic' | 'classic'
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/**
 * Shared server bootstrap for /onboarding, /onboarding/agentic, and
 * /onboarding/classic.
 *
 *   • Requires an authenticated user (redirects to /login otherwise).
 *   • If the user landed here without a workspace but stashed
 *     pending_agency_name during signup (magic-link flow), creates the
 *     workspace via create_workspace_with_agent and clears the pending_*
 *     user_metadata so subsequent visits skip this branch.
 *   • Heal-forward: if the agent shows last_completed_step = 'notify' but
 *     has a consumed pairing token, bump them to 'pair' so they don't
 *     land back at pairing after a tab close (HOR-161).
 *   • If last_completed_step === 'done', redirects to /dashboard.
 *
 * Idempotent. Safe to call from the chooser AND the child route on the
 * same request — the heavy mutations are guarded.
 */
export async function bootstrapOnboardingContext(): Promise<OnboardingContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
    const readString = (key: string): string => {
      const v = metadata[key]
      return typeof v === 'string' ? v.trim() : ''
    }
    const pendingAgencyName = readString('pending_agency_name')
    const pendingFirstName = readString('pending_first_name')
    const pendingLastName = readString('pending_last_name')
    const pendingMobile = readString('pending_mobile')
    const fullName = readString('full_name')

    if (!pendingAgencyName) {
      redirect('/signup')
    }

    let slug = slugify(pendingAgencyName)
    const { count } = await admin
      .from('workspaces')
      .select('*', { count: 'exact', head: true })
      .eq('slug', slug)
    if (count && count > 0) {
      slug = `${slug}-${Math.floor(Math.random() * 9000) + 1000}`
    }

    // Prefer the explicit pending_first/last_name from signup; fall back to
    // splitting full_name for users who signed up before the split-name form.
    let first = pendingFirstName
    let last = pendingLastName
    if (!first && !last && fullName) {
      const [head, ...tail] = fullName.split(' ').filter(Boolean)
      first = head ?? ''
      last = tail.join(' ')
    }

    const { error: rpcError } = await admin.rpc('create_workspace_with_agent', {
      p_user_id: user.id,
      p_name: pendingAgencyName,
      p_slug: slug,
      p_email: user.email ?? '',
      ...(first ? { p_first_name: first } : {}),
      ...(last ? { p_last_name: last } : {}),
      ...(pendingMobile ? { p_phone: pendingMobile } : {}),
    })

    if (rpcError) {
      console.error('[onboarding] create_workspace_with_agent error:', rpcError)
      throw new Error('Failed to set up workspace. Please contact support.')
    }

    // Internal ops signal: ping the team Slack when a new account provisions.
    // This branch runs exactly once per self-serve signup (the pending_*
    // metadata is cleared just below, so subsequent visits skip it).
    // Best-effort — postToSignupsChannel swallows its own errors.
    const signupName = [first, last].filter(Boolean).join(' ').trim()
    await postToSignupsChannel(
      `🎉 New signup: ${signupName || '(no name)'} <${user.email ?? 'no email'}> — ${pendingAgencyName}`,
    )

    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        pending_agency_name: null,
        pending_first_name: null,
        pending_last_name: null,
        pending_mobile: null,
      },
    })
  }

  // database.types.ts lags the 20260518000040 migration that adds
  // agents.onboarding_flow. Cast at the boundary until next
  // `supabase gen types` regen — same pattern as lib/onboarding/state.ts:57.
  // HOR-203: resolve the user's primary seat deterministically (a user can
  // hold multiple agents rows once support seats exist), then re-fetch the
  // full row by id (resolvePrimaryAgent only returns id/workspace_id/seat_type).
  const resolved = await resolvePrimaryAgent(admin, user.id)
  if (!resolved) {
    // Workspace creation must have failed silently — bounce back to signup.
    redirect('/signup')
  }
  const { data: agent } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, workspace_id, first_name, last_completed_step, onboarding_flow' as any)
    .eq('id', resolved.id)
    .maybeSingle()

  if (!agent) {
    // Workspace creation must have failed silently — bounce back to signup.
    redirect('/signup')
  }

  // HOR-161 heal-forward: the wizard's 'pair' step doesn't auto-advance on
  // completion — the agent taps Continue. If they close the tab mid-flow
  // after the phone has actually paired, the next visit would land them
  // back at 'pair'. Detect that case and bump last_completed_step so the
  // surface resumes at reveal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastCompleted = (agent as any).last_completed_step as OnboardingStep | null
  if (lastCompleted === 'notify') {
    const { data: latestTokenRow } = await admin
      .from('pairing_tokens')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('consumed_at')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq('agent_id', (agent as any).id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestTokenRow?.consumed_at) {
      await admin
        .from('agents')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ last_completed_step: 'pair' as any })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('id', (agent as any).id)
      lastCompleted = 'pair'
    }
  }

  if (lastCompleted === 'done') {
    redirect('/dashboard')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspaceId = (agent as any).workspace_id as string | null
  const { data: workspace } = workspaceId
    ? await admin
        .from('workspaces')
        .select('snippet_key')
        .eq('id', workspaceId)
        .maybeSingle()
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawFlow = (agent as any).onboarding_flow as string | null | undefined
  const onboardingFlow: 'agentic' | 'classic' =
    rawFlow === 'classic' ? 'classic' : 'agentic'

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agentId: (agent as any).id as string,
    workspaceId,
    snippetKey,
    appUrl,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firstName: ((agent as any).first_name as string | null) ?? null,
    email: user.email ?? '',
    lastCompletedStep: lastCompleted,
    onboardingFlow,
  }
}
