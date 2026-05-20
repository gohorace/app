import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ContactsGrid } from '@/components/contacts/contacts-grid'
import { LiveViewStrip } from '@/components/lists/live-view-strip'
import { loadContactsForList } from '@/lib/contacts/load-contacts-for-list'
import { isBuiltinSlug } from '@/lib/lists/builtin'

export const dynamic = 'force-dynamic'

/**
 * /lists/[id] — dedicated list detail (HOR-248). New in v2: lists used to
 * deep-link straight into the Contacts grid via `?list_id=` / `?builtin=`.
 *
 * `id` is either a built-in slug (`watch-closely` | `warming-up`) or a
 * `lists.id` uuid. Renders the same rich Contacts grid scoped to the list
 * (shared `loadContactsForList` helper), with the LiveViewStrip on top for
 * built-ins — they're recomputed from intent score on every load, so the
 * strip stamps the refresh time. Saved-views + manual lists skip it.
 */
export default async function ListDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent?.workspace_id) return null

  const id = params.id
  const builtin = isBuiltinSlug(id)

  const { contacts, selectedList, defaultLinkUrl, appUrl } = await loadContactsForList(admin, {
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    listId: builtin ? null : id,
    builtinSlug: builtin ? id : null,
  })

  // Unknown / soft-deleted list (and not a built-in) → 404.
  if (!selectedList) notFound()

  const refreshedAt = new Date()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Back crumb + list name */}
        <div style={{ padding: '20px 32px 0' }}>
          <Link
            href="/lists"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#8C7B6B',
              textDecoration: 'none',
              marginBottom: 10,
            }}
          >
            <ArrowLeft style={{ width: 13, height: 13 }} aria-hidden />
            Lists
          </Link>
          {selectedList.kind === 'builtin' && (
            <div style={{ maxWidth: 1200 }}>
              <LiveViewStrip refreshedAt={refreshedAt} />
            </div>
          )}
        </div>

        {/* Scoped contacts grid — its own selectedList banner names the list. */}
        <ContactsGrid
          contacts={contacts}
          agentId={agent.id}
          appUrl={appUrl}
          defaultLinkUrl={defaultLinkUrl}
          selectedList={selectedList}
        />
      </div>
    </div>
  )
}
