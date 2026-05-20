import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUILTIN_LISTS } from '@/lib/lists/builtin'
import { ListRow } from '@/components/lists/list-row'

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

  // ── Built-in counts + recently-active member (HOR-248) ───────────────────
  // One query, post-filter in JS. Workspace contact volumes are modest in
  // V1 (a few thousand at most), so the trip is cheap. We now also pull
  // names + last_seen so the cards can surface a "recently added" member
  // and a "+N this week" badge. NOTE: built-ins are score-threshold lists
  // with no membership rows, so there's no true "added" timestamp — we use
  // last_seen_at as the recency proxy (phrased "active", not "added").
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
  const { data: scoreRows } = await admin
    .from('contacts')
    .select('id, first_name, last_name, score, last_seen_at')
    .eq('agent_id', agentId)
    .is('deleted_at', null)

  type BuiltinStat = {
    count: number
    newThisWeek: number
    recent: { id: string; name: string; lastSeenAt: string } | null
  }
  const builtinStats = new Map<string, BuiltinStat>()
  for (const def of BUILTIN_LISTS) {
    builtinStats.set(def.slug, { count: 0, newThisWeek: 0, recent: null })
  }
  const now = Date.now()
  for (const r of scoreRows ?? []) {
    for (const def of BUILTIN_LISTS) {
      if (r.score < def.minScore) continue
      if (def.maxScoreExclusive !== null && r.score >= def.maxScoreExclusive) continue
      const stat = builtinStats.get(def.slug)!
      stat.count += 1
      const seen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0
      if (seen && now - seen <= SEVEN_DAYS_MS) stat.newThisWeek += 1
      if (r.last_seen_at && (!stat.recent || r.last_seen_at > stat.recent.lastSeenAt)) {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'A contact'
        stat.recent = { id: r.id, name, lastSeenAt: r.last_seen_at }
      }
    }
  }

  // Voice line: lead with the built-in that has the freshest recent member.
  const voiceLead = [...BUILTIN_LISTS]
    .map((def) => ({ def, stat: builtinStats.get(def.slug)! }))
    .filter((x) => x.stat.recent && x.stat.newThisWeek > 0)
    .sort((a, b) => (b.stat.recent!.lastSeenAt > a.stat.recent!.lastSeenAt ? 1 : -1))[0] ?? null

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

        {/* HOR-248: Horace voice line — leads with the built-in that has the
            freshest member this week. Phrased "active" (last_seen proxy)
            rather than "added" — built-ins have no membership timestamp. */}
        {voiceLead && (
          <div
            style={{
              marginBottom: 26,
              padding: '14px 18px',
              background: 'rgba(196,98,45,0.06)',
              border: '1px solid rgba(196,98,45,0.18)',
              borderRadius: 10,
            }}
          >
            <p
              className="font-display"
              style={{ margin: 0, fontSize: 15, fontStyle: 'italic', lineHeight: 1.55, color: '#1A1612' }}
            >
              <span style={{ fontWeight: 600, fontStyle: 'normal', color: '#A85220' }}>
                {voiceLead.def.name}
              </span>{' '}
              has{' '}
              <span style={{ fontWeight: 600, fontStyle: 'normal' }}>
                {voiceLead.stat.newThisWeek} new
              </span>{' '}
              this week — {voiceLead.stat.recent!.name} active {formatRelative(voiceLead.stat.recent!.lastSeenAt)}.
            </p>
          </div>
        )}

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
          {BUILTIN_LISTS.map((def) => {
            const stat = builtinStats.get(def.slug)!
            return (
              <Link
                key={def.slug}
                href={`/lists/${def.slug}`}
                className="signal-card"
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
                    style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: '#1A1612' }}
                  >
                    {def.name}
                  </span>
                  {stat.newThisWeek > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#A85220',
                        background: 'rgba(196,98,45,0.12)',
                        padding: '2px 7px',
                        borderRadius: 9999,
                      }}
                    >
                      +{stat.newThisWeek} this week
                    </span>
                  )}
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
                    {stat.count}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: '#5E5246', fontStyle: 'italic', lineHeight: 1.5 }}>
                  {def.blurb}
                </p>
                {/* Recently active member — small avatar + name + when. */}
                {stat.recent && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: '1px solid rgba(140,123,107,0.14)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'rgba(196,98,45,0.18)',
                        color: '#C4622D',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-display)',
                        fontSize: 9.5,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {initialsOf(stat.recent.name)}
                    </span>
                    <span style={{ fontSize: 12, color: '#1A1612', fontWeight: 500 }}>
                      {stat.recent.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8C7B6B' }}>
                      · {formatRelative(stat.recent.lastSeenAt)}
                    </span>
                  </div>
                )}
              </Link>
            )
          })}
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
              // HOR-168: intentionally not `overflow: hidden` — the
              // RowOverflowMenu popover renders below its trigger via
              // position:absolute and would otherwise be clipped. The last
              // row has no border-bottom, so nothing bleeds past the
              // rounded corners visually.
            }}
          >
            {savedLists.map((l, idx) => (
              <ListRow
                key={l.id}
                isLast={idx === savedLists.length - 1}
                list={{
                  id: l.id,
                  name: l.name,
                  description: l.description,
                  kind: l.kind as 'manual' | 'saved_filter',
                  updated_at: l.updated_at,
                  memberCount: l.kind === 'manual' ? (memberCount.get(l.id) ?? 0) : null,
                }}
              />
            ))}
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

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
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
