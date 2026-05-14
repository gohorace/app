import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  // If the user landed here without a workspace but stashed `pending_agency_name`
  // during signup (magic-link flow), create the workspace before rendering.
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

    // Clear the stashed values so subsequent visits skip this branch.
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

  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id, first_name, last_completed_step')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) {
    // Workspace creation must have failed silently — bounce back to signup.
    redirect('/signup')
  }

  // HOR-161 heal-forward: the wizard's 'pair' step doesn't auto-
  // advance on completion — the agent taps Continue. If they close
  // the tab mid-flow after the phone has actually paired, the next
  // visit would land them back at 'pair'. Detect that case here and
  // bump last_completed_step so the wizard resumes at the reveal.
  let lastCompleted = agent.last_completed_step
  if (lastCompleted === 'notify') {
    const { data: latestTokenRow } = await admin
      .from('pairing_tokens')
      .select('consumed_at')
      .eq('agent_id', agent.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestTokenRow?.consumed_at) {
      await admin
        .from('agents')
        .update({ last_completed_step: 'pair' })
        .eq('id', agent.id)
      lastCompleted = 'pair'
    }
  }

  // Already finished — go straight to the dashboard.
  if (lastCompleted === 'done') {
    redirect('/dashboard')
  }

  const { data: workspace } = agent.workspace_id
    ? await admin
        .from('workspaces')
        .select('snippet_key')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'

  return (
    <OnboardingWizard
      agentId={agent.id}
      snippetKey={snippetKey}
      appUrl={appUrl}
      firstName={agent.first_name}
      lastCompletedStep={lastCompleted}
    />
  )
}
