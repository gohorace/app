import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateCompanionReply } from '@/lib/ai/companion'
import type { ConversationTurn, HoraceMessage } from '@/lib/companion/types'

const MAX_HISTORY_TURNS = 12
const MAX_TURN_CHARS = 1000

/** Validate + cap the client-supplied thread history. Keeps only well-formed
 *  agent/horace turns, trims each, and bounds the count to the most recent. */
function sanitizeHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return []
  const turns: ConversationTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const role = (item as ConversationTurn).role
    const text = (item as ConversationTurn).text
    if ((role === 'agent' || role === 'horace') && typeof text === 'string' && text.trim()) {
      turns.push({ role, text: text.trim().slice(0, MAX_TURN_CHARS) })
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS)
}

// POST /api/companion/respond  (HOR-271)
//
// The real "Ask Horace" brain. Takes the agent's prompt + optional context
// label, retrieves a workspace-scoped slice of their data, and returns a
// grounded HoraceMessage (text + optional italics / references / action).
// Replaces the client-side pattern-matched mock. The Anthropic key stays
// server-side; when it's unset the brain returns a deterministic fallback.
//
// 200 — a HoraceMessage (always, even on internal failure — soft fallback copy)
// 401 — no session / no workspace
// 422 — bad body

interface Body {
  prompt?: string
  contextLabel?: string | null
  history?: unknown
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 422 })
  }
  const contextLabel =
    typeof body.contextLabel === 'string' && body.contextLabel.trim()
      ? body.contextLabel.trim()
      : undefined

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { data: agent } = await supabase
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 401 })
  }

  const key = process.env.ANTHROPIC_API_KEY
  const client = key ? new Anthropic({ apiKey: key }) : null

  try {
    // Admin client + explicit agent/workspace scoping, matching the MCP tools.
    const reply = await generateCompanionReply(
      client,
      createAdminClient(),
      agent.id,
      agent.workspace_id,
      prompt,
      contextLabel,
      sanitizeHistory(body.history),
    )
    return NextResponse.json(reply)
  } catch (err) {
    console.error('[companion/respond] failed:', err)
    const soft: HoraceMessage = {
      kind: 'horace',
      text: 'I hit a snag reaching your data just now — give me another go in a moment.',
    }
    return NextResponse.json(soft, { status: 200 })
  }
}
