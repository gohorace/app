import Link from 'next/link'
import { Sparkles, ListPlus, Bookmark } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUILTIN_LISTS } from '@/lib/lists/builtin'

export const dynamic = 'force-dynamic'

// HOR-144  /lists — overview surface.
//
// Two panels:
//   1. Built-ins (Watch closely / Warming up) — score-based, no row in DB.
//      Counts computed inline from a single `contacts` aggregate query.
//   2. Your lists — manual + saved_filter rows the agent has created, with
//      member count + last-updated. Saved-filter lists carry a star to
//      distinguish them from manual buckets at a glance.
//
// Every row links into the existing Contacts grid via ?list_id= or
// ?builtin=, so we don't need a parallel single-list view in V1 — the
// grid already renders the appropriate banner from the searchParam.
//
// No Add-to-list affordance lives here intentionally: lists are created
// from the surfaces where people are (Digest, Contact detail, Save-as-
// list on the grid). The overview is read-only.

export default async function ListsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    // Unreachable under the dashboard layout (which redirects unauthenticated
    // users), but keeps the type narrow without a !.
    return null
  }
  const workspaceId = agent.workspace_id
  const agentId = agent.id

  // ── Built-in counts ─────────────────────────────────────────────────────
  // One query, post-filter in JS. Workspace contact volumes are modest in
  // V1 (a few thousand at most), so the trip is cheap; we can switch to
  // grouped RPCs if it ever bites.
  const { data: scoreRows } = await admin
    .from('contacts')
    .select('score')
    .eq('agent_id', agentId)
    .is('deleted_at', null)

  const builtinCounts = new Map<string, number>()
  for (const def of BUILTIN_LISTS) builtinCounts.set(def.slug, 0)
  for (const r of scoreRows ?? []) {
    for (const def of BUILTIN_LISTS) {
      if (r.score < def.minScore) continue
      if (def.maxScoreExclusive !== null && r.score >= def.maxScoreExclusive) continue
      builtinCounts.set(def.slug, (builtinCounts.get(def.slug) ?? 0) + 1)
    }
  }

  // ── Saved lists ─────────────────────────────────────────────────────────
  const { data: listsData } = await admin
    .from('lists')
    .select('id, name, description, kind, created_at, updated_at, agent_id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  const savedLists = listsData ?? []
  const manualIds = savedLists.filter((l) => l.kind === 'manual').map((l) => l.id)
  const memberCount = new Map<string, number>()
  if (manualIds.length > 0) {
    const { data: rows } = await admin
      .from('contact_list_membership')
      .select('list_id')
      .in('list_id', manualIds)
    for (const r of rows ?? []) {
      memberCount.set(r.list_id, (memberCount.get(r.list_id) ?? 0) + 1)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '32px 32px 80px',
      }}
    >
      <div style={{ maxWidth: 1000 }}>
        {/* Header */}
        <div style={{ marginBottom: 26 }}>
          <h1
            className="font-display"
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#1A1612',
            }}
          >
            Lists
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: '#8C7B6B',
              maxWidth: 580,
              lineHeight: 1.55,
            }}
          >
            Built-in views Horace keeps up to date for you, plus any lists you&rsquo;ve
            saved from a filter or added contacts to. Click through to see who&rsquo;s in.
          </p>
        </div>

        {/* Built-ins panel */}
        <PanelHeader title="Built-in" subtitle="Live views — Horace recomputes counts on every page load." />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            marginBottom: 32,
          }}
        >
          {BUILTIN_LISTS.map((def) => (
            <Link
              key={def.slug}
              href={`/contacts?builtin=${def.slug}`}
              style={{
                display: 'block',
                padding: '18px 20px',
                background: '#FAF7F2',
                border: '1px solid rgba(140,123,107,0.2)',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'inherit',
                transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: 'rgba(196,98,45,0.1)',
                    color: '#C4622D',
                  }}
                >
                  <Sparkles style={{ width: 13, height: 13 }} aria-hidden />
                </span>
                <span
                  className="font-display"
                  style={{
                    fontSize: 17,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    color: '#1A1612',
                  }}
                >
                  {def.name}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: '#5E5246',
                    background: 'rgba(140,123,107,0.12)',
                    padding: '2px 8px',
                    borderRadius: 9999,
                  }}
                >
                  {builtinCounts.get(def.slug) ?? 0}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: '#5E5246',
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                {def.blurb}
              </p>
            </Link>
          ))}
        </div>

        {/* Your lists panel */}
        <PanelHeader
          title="Your lists"
          subtitle={
            savedLists.length === 0
              ? null
              : 'Manual buckets and saved filter views, ordered by most recently touched.'
          }
        />
        {savedLists.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            {savedLists.map((l, idx) => {
              const isLast = idx === savedLists.length - 1
              const isSaved = l.kind === 'saved_filter'
              const count = isSaved ? null : (memberCount.get(l.id) ?? 0)
              return (
                <Link
                  key={l.id}
                  href={`/contacts?list_id=${l.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 18px',
                    borderBottom: isLast ? 'none' : '1px solid rgba(140,123,107,0.1)',
                    textDecoration: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: isSaved ? 'rgba(61,82,70,0.1)' : 'rgba(196,98,45,0.08)',
                      color: isSaved ? '#3D5246' : '#C4622D',
                      flexShrink: 0,
                    }}
                  >
                    {isSaved ? (
                      <Bookmark style={{ width: 13, height: 13 }} aria-hidden />
                    ) : (
                      <ListPlus style={{ width: 13, height: 13 }} aria-hidden />
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: '#1A1612',
                        }}
                      >
                        {l.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: isSaved ? '#3D5246' : '#C4622D',
                        }}
                      >
                        {isSaved ? 'Saved view' : 'List'}
                      </span>
                    </div>
                    {l.description && (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#8C7B6B',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {l.description}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      flexShrink: 0,
                    }}
                  >
                    {count !== null && (
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: '#5E5246',
                          background: 'rgba(140,123,107,0.12)',
                          padding: '2px 8px',
                          borderRadius: 9999,
                        }}
                      >
                        {count} {count === 1 ? 'member' : 'members'}
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: '#8C7B6B',
                      }}
                    >
                      {formatRelative(l.updated_at)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string | null }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2
        className="font-display"
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 500,
          color: '#1A1612',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8C7B6B' }}>{subtitle}</p>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '32px 24px',
        background: '#FAF7F2',
        border: '1px dashed rgba(140,123,107,0.3)',
        borderRadius: 12,
        textAlign: 'center',
      }}
    >
      <p
        className="font-display"
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 500,
          color: '#1A1612',
        }}
      >
        Lists keep your people grouped.
      </p>
      <p
        style={{
          margin: '6px 0 14px',
          fontSize: 12.5,
          color: '#8C7B6B',
          maxWidth: 420,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        Add a contact to a list from the Digest or any contact&rsquo;s page, or save the
        current Contacts filter as a view you can return to.
      </p>
      <Link
        href="/contacts"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          fontSize: 12.5,
          fontWeight: 500,
          color: '#FAF7F2',
          background: '#1A1612',
          border: '1px solid #1A1612',
          borderRadius: 7,
          textDecoration: 'none',
        }}
      >
        Open Contacts
      </Link>
    </div>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)   return 'Just now'
  if (minutes < 60)  return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1)    return 'Yesterday'
  if (days < 7)      return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4)     return `${weeks}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
