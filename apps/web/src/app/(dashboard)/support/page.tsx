import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAttentionCount } from '@/lib/notifications/attention-count'
import { createAdminClient } from '@/lib/supabase/admin'
import { BellButton } from '@/components/dashboard/bell-button'

// v2-M1 stub (HOR-242). The real Support screen lands in v2-M10 (HOR-251) —
// Ask Horace CTA, hero "Start here" card, guides grid, talk-to-a-human
// links, status strip. Until then this renders the topbar so the sidebar
// link resolves cleanly.
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) redirect('/signup')

  const admin = createAdminClient()
  const attentionCount = await fetchAttentionCount(admin, agent.id)

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: '#F5F0E8' }}>
      <div style={{ padding: '28px 32px 0', maxWidth: 1240 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 22,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#8C7B6B',
                marginBottom: 8,
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#C4622D' }}
              />
              Account · Help &amp; support
            </div>
            <h1
              className="font-display"
              style={{
                margin: 0,
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
                color: '#1A1612',
              }}
            >
              Support
            </h1>
          </div>
          <div style={{ flexShrink: 0, marginTop: 4 }}>
            <BellButton attentionCount={attentionCount} />
          </div>
        </div>

        <section
          style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.22)',
            borderRadius: 12,
            padding: '28px 32px',
            color: '#5E5246',
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 18,
            lineHeight: 1.55,
          }}
        >
          Horace is building the support hub. Guides, a path to a human, and a
          status strip — coming with v2-M10.
        </section>
      </div>
    </div>
  )
}
