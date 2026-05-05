import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ClaudeButton } from '@/components/ui/claude-button'
import { AddContactDialog } from '@/components/contacts/add-contact-dialog'

type Intent = 'high' | 'mid' | 'low' | 'none'

function getIntent(score: number): Intent {
  if (score >= 50) return 'high'
  if (score >= 20) return 'mid'
  if (score >= 5)  return 'low'
  return 'none'
}

const DOT_COLOR: Record<Intent, string> = {
  high: '#C4622D', mid: '#B5922A', low: '#3D5246', none: '#8C7B6B',
}
const INTENT_LABEL: Record<Intent, string> = {
  high: 'High', mid: 'Mid', low: 'Watching', none: 'Quiet',
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id
  const q = searchParams.q?.trim() ?? ''

  let query = admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, score, last_seen_at, crm_source')
    .eq('agent_id', agentId)
    .order('score', { ascending: false })
    .limit(200)

  if (q) {
    query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
  }

  const { data: leads } = await query

  return (
    <div className="p-8 space-y-5 max-w-4xl">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
        <div>
          <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '26px', color: '#1A1612' }}>
            Contacts
          </h1>
          <p style={{ fontSize: '13px', color: '#8C7B6B', marginTop: '2px' }}>
            Everyone Horace is watching for you.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ClaudeButton
            prompt={`I'm a real estate agent. I have ${leads?.length ?? 0} contacts tracked in Horace. Top contacts: ${(leads ?? []).slice(0, 5).map(l => `${[l.first_name, l.last_name].filter(Boolean).join(' ') || l.email} (score: ${l.score})`).join(', ')}. Who should I focus on?`}
            label="Ask Claude"
            size="sm"
          />
          <AddContactDialog />
        </div>
      </div>

      {/* Search */}
      <form method="GET">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or email…"
          style={{
            height: '36px', padding: '0 12px',
            borderRadius: '7px',
            border: '1px solid rgba(140,123,107,0.3)',
            background: '#FAF7F2',
            fontSize: '13px', color: '#1A1612',
            fontFamily: 'var(--font-body)',
            outline: 'none',
            width: '260px',
          }}
        />
      </form>

      {/* Table */}
      {!leads || leads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#8C7B6B' }}>
          <p style={{ fontSize: '14px', fontWeight: 500, color: '#1A1612' }}>
            {q ? `No contacts match "${q}"` : 'No contacts yet.'}
          </p>
          {!q && (
            <p style={{ fontSize: '13px', marginTop: '8px' }}>
              <Link href="/import" style={{ color: '#C4622D', textDecoration: 'underline' }}>Import your contacts</Link>
              {' '}or use the button above to add one.
            </p>
          )}
        </div>
      ) : (
        <div style={{
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          {/* Table head */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '10px 16px',
            borderBottom: '1px solid rgba(140,123,107,0.15)',
            fontSize: '10px', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: '#8C7B6B', gap: '12px',
          }}>
            <span style={{ flex: 2 }}>Name</span>
            <span style={{ flex: 2 }}>Email</span>
            <span style={{ flex: 1 }}>Signal</span>
            <span style={{ flex: 1 }}>Score</span>
            <span style={{ flex: 1 }}>Last seen</span>
          </div>

          {/* Table rows */}
          {leads.map(lead => {
            const name    = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—'
            const intent  = getIntent(lead.score)
            const initials = ((lead.first_name?.[0] ?? '') + (lead.last_name?.[0] ?? '')).toUpperCase() ||
              (lead.email?.[0]?.toUpperCase() ?? '?')

            return (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid rgba(140,123,107,0.1)',
                  gap: '12px',
                  textDecoration: 'none',
                  transition: 'background 120ms',
                }}
                className="contact-row"
              >
                {/* Avatar + name */}
                <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 600, flexShrink: 0,
                    background: intent === 'high' ? 'rgba(196,98,45,0.12)' : 'rgba(140,123,107,0.1)',
                    color: intent === 'high' ? '#C4622D' : '#8C7B6B',
                  }}>
                    {initials.slice(0, 2)}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1A1612', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </span>
                </div>

                {/* Email */}
                <span style={{ flex: 2, fontSize: '13px', color: '#8C7B6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.email ?? '—'}
                </span>

                {/* Intent */}
                <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 500, color: DOT_COLOR[intent] }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: DOT_COLOR[intent], flexShrink: 0, display: 'inline-block' }} />
                  {INTENT_LABEL[intent]}
                </span>

                {/* Score */}
                <span style={{ flex: 1, fontSize: '13px', color: '#1A1612', fontFamily: 'var(--font-mono)' }}>
                  {lead.score}
                </span>

                {/* Last seen */}
                <span style={{ flex: 1, fontSize: '12px', color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>
                  {lead.last_seen_at
                    ? formatDistanceToNow(new Date(lead.last_seen_at), { addSuffix: true })
                    : '—'}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Row count */}
      {leads && leads.length > 0 && (
        <p style={{ fontSize: '12px', color: '#8C7B6B' }}>
          {q
            ? `${leads.length} result${leads.length !== 1 ? 's' : ''} for "${q}"`
            : `${leads.length} contact${leads.length !== 1 ? 's' : ''}`}
        </p>
      )}
    </div>
  )
}
