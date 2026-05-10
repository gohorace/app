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
    const pendingAgencyName = typeof metadata.pending_agency_name === 'string'
      ? metadata.pending_agency_name.trim()
      : ''
    const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : ''

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

    const [first, ...rest] = fullName.split(' ').filter(Boolean)
    const last = rest.join(' ')

    const { error: rpcError } = await admin.rpc('create_workspace_with_agent', {
      p_user_id: user.id,
      p_name: pendingAgencyName,
      p_slug: slug,
      p_email: user.email ?? '',
      ...(first ? { p_first_name: first } : {}),
      ...(last ? { p_last_name: last } : {}),
    })

    if (rpcError) {
      console.error('[onboarding] create_workspace_with_agent error:', rpcError)
      throw new Error('Failed to set up workspace. Please contact support.')
    }

    // Clear the stashed value so subsequent visits skip this branch.
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...metadata, pending_agency_name: null },
    })
  }

  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: workspace } = agent?.workspace_id
    ? await admin
        .from('workspaces')
        .select('snippet_key')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'

  return <OnboardingWizard snippetKey={snippetKey} appUrl={appUrl} />
}
