import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ContactsGrid } from '@/components/contacts/contacts-grid'
import { loadContactsForList } from '@/lib/contacts/load-contacts-for-list'

export const dynamic = 'force-dynamic'

export default async function ContactsPage({
  searchParams,
}: {
  // HOR-143/HOR-144:
  //   ?list_id=<uuid>   manual list → scope rows; saved_filter → hydrate.
  //   ?builtin=<slug>   computed list (warming-up | watch-closely) →
  //                     scope rows by score threshold.
  // Both are mutually exclusive at the URL level; list_id wins if both sent.
  // HOR-248: the heavy three-read load + scoping moved to
  // `lib/contacts/load-contacts-for-list.ts` so /lists/[id] shares it.
  searchParams: { q?: string; list_id?: string; builtin?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const q = searchParams.q?.trim() ?? ''
  const { contacts, selectedList, defaultLinkUrl, appUrl } = await loadContactsForList(admin, {
    agentId: agent!.id,
    workspaceId: agent!.workspace_id,
    listId: searchParams.list_id ?? null,
    builtinSlug: searchParams.builtin ?? null,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ContactsGrid
        contacts={contacts}
        initialQ={q}
        agentId={agent!.id}
        appUrl={appUrl}
        defaultLinkUrl={defaultLinkUrl}
        selectedList={selectedList}
      />
    </div>
  )
}
