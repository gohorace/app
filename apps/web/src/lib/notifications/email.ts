import type { LeadWithInsight } from '@/lib/ai/briefing'

export type { LeadWithInsight }

// ── HOR-155 — Doorstep digest section types ──────────────────────────────────

/** One row per scan from the daily-briefing inspections RPC. */
export interface DigestInspectionScan {
  name: string
  captured_at: string
  has_revisit: boolean
}

/** One row per inspection the agent ran in the lookback window. */
export interface DigestInspection {
  inspection_id: string
  inspection_type: string
  address: string
  scheduled_at: string
  scan_count: number
  revisit_count: number
  scans: DigestInspectionScan[]
}

// ── Shared design tokens (email-safe hex values) ──────────────────────────────

const T = {
  parchment:  '#F5F0E8',
  cream:      '#FAF7F2',
  charcoal:   '#2E2823',
  ink:        '#1A1612',
  terracotta: '#C4622D',
  stone:      '#8C7B6B',
  border:     '#E4DCDA',
  intentHigh: { bg: 'rgba(196,98,45,0.12)', fg: '#C4622D' },
  intentMid:  { bg: '#FEF3C7', fg: '#92400E' },
  intentLow:  { bg: 'rgba(61,82,70,0.1)',   fg: '#3D5246' },
}

// ── Shared email shell ────────────────────────────────────────────────────────

function shell(bodyContent: string, footerContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Horace</title>
</head>
<body style="margin:0;padding:0;background:${T.parchment};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${T.parchment};padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;width:100%;">

        <!-- Wordmark header -->
        <tr>
          <td style="background:${T.charcoal};border-radius:12px 12px 0 0;padding:18px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td>
                  <table cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td style="vertical-align:middle;padding-right:7px;">
                        <div style="width:8px;height:8px;border-radius:50%;background:${T.terracotta};"></div>
                      </td>
                      <td style="vertical-align:middle;">
                        <span style="font-size:18px;font-weight:700;color:${T.cream};letter-spacing:-0.01em;">Horace</span>
                      </td>
                    </tr>
                  </table>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="font-size:11px;color:rgba(245,240,232,0.4);letter-spacing:0.04em;text-transform:uppercase;">
                    ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:${T.cream};padding:28px 28px 8px;border-left:1px solid ${T.border};border-right:1px solid ${T.border};">
            ${bodyContent}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:${T.parchment};border:1px solid ${T.border};border-top:none;border-radius:0 0 12px 12px;padding:16px 28px;">
            ${footerContent}
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Contact card ──────────────────────────────────────────────────────────────

function contactCard(lead: LeadWithInsight, appUrl: string, isFirst: boolean): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown'
  const initials = [lead.first_name?.[0], lead.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const profileUrl = `${appUrl}/contacts/${lead.contact_id}`

  const isHigh = lead.score >= 50
  const isMid  = lead.score >= 20 && lead.score < 50

  const avatarBg    = isHigh ? T.terracotta : isMid ? '#B5922A' : T.stone
  const intentLabel = isHigh ? 'High intent' : isMid ? 'Mid intent' : 'Watching'
  const intentBg    = isHigh ? 'rgba(196,98,45,0.1)' : isMid ? '#FEF3C7' : 'rgba(140,123,107,0.1)'
  const intentFg    = isHigh ? T.terracotta : isMid ? '#92400E' : T.stone

  const changeText  = lead.score_change > 0
    ? `<span style="color:${T.terracotta};font-size:11px;margin-left:5px;">+${lead.score_change}</span>`
    : ''

  const borderTop = isFirst ? 'none' : `1px solid ${T.border}`

  return `
    <tr>
      <td style="padding:20px 0;border-top:${borderTop};">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">

          <!-- Name row -->
          <tr>
            <td style="vertical-align:top;padding-right:12px;width:44px;">
              <div style="width:40px;height:40px;border-radius:50%;background:${avatarBg};text-align:center;line-height:40px;">
                <span style="font-size:14px;font-weight:700;color:${T.cream};letter-spacing:-0.01em;">${initials}</span>
              </div>
            </td>
            <td style="vertical-align:middle;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td>
                    <a href="${profileUrl}" style="font-size:15px;font-weight:700;color:${T.ink};text-decoration:none;">${name}</a>
                    ${lead.email && lead.email !== name ? `<span style="color:${T.stone};font-size:12px;"> · ${lead.email}</span>` : ''}
                  </td>
                  <td align="right" style="white-space:nowrap;padding-left:12px;vertical-align:middle;">
                    <span style="font-size:18px;font-weight:700;color:${T.ink};letter-spacing:-0.02em;">${lead.score}</span>
                    ${changeText}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:5px;">
                    <span style="display:inline-block;font-size:10px;font-weight:600;background:${intentBg};color:${intentFg};padding:2px 8px;border-radius:9999px;letter-spacing:0.01em;">
                      ${intentLabel}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Why now -->
          <tr>
            <td colspan="2" style="padding-top:12px;padding-left:52px;">
              <p style="margin:0;font-size:13px;color:${T.charcoal};line-height:1.6;">
                ${lead.insight.why_now}
              </p>
            </td>
          </tr>

          <!-- Action -->
          <tr>
            <td colspan="2" style="padding-top:10px;padding-left:52px;">
              <table cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(196,98,45,0.07);border-left:3px solid ${T.terracotta};border-radius:0 6px 6px 0;">
                <tr>
                  <td style="padding:8px 12px;">
                    <p style="margin:0;font-size:13px;font-weight:600;color:${T.terracotta};line-height:1.5;">
                      → ${lead.insight.action}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- View link -->
          <tr>
            <td colspan="2" style="padding-top:10px;padding-left:52px;">
              <a href="${profileUrl}" style="font-size:12px;color:${T.stone};text-decoration:none;border-bottom:1px solid ${T.border};">
                View ${lead.first_name ?? 'contact'}'s activity →
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>`
}

// ── HOR-155 — Doorstep digest block ──────────────────────────────────────────

function formatScheduledForEmail(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function inspectionBlock(insp: DigestInspection): string {
  const time = formatScheduledForEmail(insp.scheduled_at)
  const scanSummary = insp.scan_count === 0
    ? 'No sign-ins.'
    : insp.scan_count === 1
      ? `1 scan. ${insp.revisit_count > 0 ? '1 already back on your site.' : 'No revisit yet.'}`
      : `${insp.scan_count} scans. ${insp.revisit_count > 0 ? `${insp.revisit_count} already back on your site.` : 'No revisits yet.'}`

  const scanList = insp.scans.length === 0 ? '' : `
    <ul style="margin:8px 0 0;padding:0 0 0 18px;list-style:disc;color:${T.charcoal};font-size:13px;line-height:1.7;">
      ${insp.scans.map((s) => `
        <li>
          <span style="color:${T.charcoal};">${escapeHtml(s.name || 'Anonymous')}</span>
          <span style="color:${T.stone};"> — ${s.has_revisit ? 'back on your site' : 'no revisit yet'}</span>
        </li>
      `).join('')}
    </ul>
  `

  return `
    <div style="margin-bottom:16px;padding:14px 16px;background:${T.cream};border:1px solid ${T.border};border-radius:8px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:500;color:${T.charcoal};">
        ${escapeHtml(insp.address)}
        <span style="color:${T.stone};font-weight:400;"> — ${escapeHtml(time)}</span>
      </p>
      <p style="margin:0;font-size:13px;color:${T.stone};">${escapeHtml(scanSummary)}</p>
      ${scanList}
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Daily briefing email ──────────────────────────────────────────────────────

export function buildDailyBriefingEmail(
  agentName: string,
  leads: LeadWithInsight[],
  narrative: string,
  appUrl: string,
  /** HOR-155: inspections from the previous 24h. Empty array = section omitted. */
  inspections: DigestInspection[] = [],
): { subject: string; html: string } {
  const agentFirst = agentName.split(' ')[0] || agentName

  const subject = leads.length === 0
    ? `Your daily brief — quiet today`
    : leads.length === 1
      ? `Your daily brief — 1 contact worth your attention`
      : `Your daily brief — ${leads.length} contacts worth your attention`

  const signOff = `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${T.border};">
      <p style="margin:0;font-size:13px;color:${T.charcoal};line-height:1.6;font-style:italic;">Seize the moment — Horace</p>
    </div>
  `

  // HOR-155 — "Open homes yesterday" block. Heading stays "Open homes"
  // (the specific event the prospect attended) even though the agent
  // surface elsewhere uses "Inspections" — v1 only writes
  // inspection_type='open_home', and the prospect-facing event copy is
  // the right register here.
  const inspectionsSection = inspections.length === 0 ? '' : `
    <div style="margin-top:32px;padding-top:24px;border-top:1px solid ${T.border};">
      <p style="margin:0 0 14px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${T.stone};">
        Open homes yesterday
      </p>
      ${inspections.map((insp) => inspectionBlock(insp)).join('')}
    </div>
  `

  const emptyState = `
    <p style="margin:0 0 24px;font-size:14px;color:${T.stone};line-height:1.6;font-style:italic;">
      &ldquo;${narrative}&rdquo;
    </p>
    ${inspectionsSection}
    ${signOff}
  `

  const leadsBody = leads.length === 0 ? emptyState : `
    <!-- Narrative intro -->
    <p style="margin:0 0 24px;font-size:14px;color:${T.charcoal};line-height:1.65;font-style:italic;border-left:3px solid ${T.terracotta};padding-left:14px;">
      &ldquo;${narrative}&rdquo;
    </p>

    <!-- Contact cards -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid ${T.border};">
      <tbody>
        ${leads.map((lead, i) => contactCard(lead, appUrl, i === 0)).join('')}
      </tbody>
    </table>

    ${inspectionsSection}

    <!-- View all CTA -->
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${T.border};text-align:center;">
      <a href="${appUrl}/dashboard" style="display:inline-block;background:${T.ink};color:${T.cream};text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:6px;">
        Open Horace →
      </a>
    </div>
    ${signOff}
    <div style="height:20px;"></div>
  `

  const footerContent = `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="font-size:11px;color:${T.stone};">
          Daily brief for ${agentFirst}
        </td>
        <td align="right" style="font-size:11px;">
          <a href="${appUrl}/settings/notifications" style="color:${T.stone};text-decoration:none;border-bottom:1px solid ${T.border};">Manage preferences</a>
        </td>
      </tr>
    </table>
  `

  return { subject, html: shell(leadsBody, footerContent) }
}

// ── Weekly briefing email ─────────────────────────────────────────────────────

export function buildWeeklyBriefingEmail(
  agentName: string,
  leads: LeadWithInsight[],
  narrative: string,
  appUrl: string,
): { subject: string; html: string } {
  const agentFirst = agentName.split(' ')[0] || agentName

  const subject = leads.length === 0
    ? `Your weekly brief — quiet this week`
    : leads.length === 1
      ? `Your weekly brief — 1 contact to act on`
      : `Your weekly brief — ${leads.length} contacts to act on`

  const signOff = `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${T.border};">
      <p style="margin:0;font-size:13px;color:${T.charcoal};line-height:1.6;font-style:italic;">Seize the moment — Horace</p>
    </div>
  `

  const leadsBody = leads.length === 0 ? `
    <p style="margin:0 0 24px;font-size:14px;color:${T.stone};line-height:1.6;font-style:italic;">
      &ldquo;${narrative}&rdquo;
    </p>
    ${signOff}
  ` : `
    <!-- Narrative intro -->
    <p style="margin:0 0 24px;font-size:14px;color:${T.charcoal};line-height:1.65;font-style:italic;border-left:3px solid ${T.terracotta};padding-left:14px;">
      &ldquo;${narrative}&rdquo;
    </p>

    <!-- Contact cards -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid ${T.border};">
      <tbody>
        ${leads.map((lead, i) => contactCard(lead, appUrl, i === 0)).join('')}
      </tbody>
    </table>

    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${T.border};text-align:center;">
      <a href="${appUrl}/dashboard" style="display:inline-block;background:${T.ink};color:${T.cream};text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:6px;">
        Open Horace →
      </a>
    </div>
    ${signOff}
    <div style="height:20px;"></div>
  `

  const footerContent = `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="font-size:11px;color:${T.stone};">
          Weekly brief for ${agentFirst}
        </td>
        <td align="right" style="font-size:11px;">
          <a href="${appUrl}/settings/notifications" style="color:${T.stone};text-decoration:none;border-bottom:1px solid ${T.border};">Manage preferences</a>
        </td>
      </tr>
    </table>
  `

  return { subject, html: shell(leadsBody, footerContent) }
}

// ── Magic link email ──────────────────────────────────────────────────────────

export type MagicLinkAction =
  | 'signup'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'invite'
  | 'reauthentication'

const MAGIC_COPY: Record<MagicLinkAction, { subject: string; heading: string; body: string; cta: string }> = {
  signup: {
    subject: 'Confirm your email to start using Horace',
    heading: 'One click to finish signing up',
    body: `Tap the button below to confirm your email and open your Horace workspace. The link expires in 10 minutes.`,
    cta: 'Confirm and sign in',
  },
  magiclink: {
    subject: 'Your Horace sign-in link',
    heading: 'Sign in to Horace',
    body: `Tap the button below to sign in. The link expires in 10 minutes and can only be used once.`,
    cta: 'Sign in to Horace',
  },
  recovery: {
    subject: 'Recover your Horace account',
    heading: 'Recover your account',
    body: `Tap the button below to sign in and pick up where you left off. The link expires in 10 minutes.`,
    cta: 'Sign in to Horace',
  },
  email_change: {
    subject: 'Confirm your new email for Horace',
    heading: 'Confirm your new email',
    body: `Tap the button below to confirm this address as your new sign-in email for Horace. The link expires in 10 minutes.`,
    cta: 'Confirm new email',
  },
  invite: {
    subject: 'You have been invited to Horace',
    heading: 'Welcome to Horace',
    body: `Tap the button below to accept the invitation and sign in. The link expires in 10 minutes.`,
    cta: 'Accept invitation',
  },
  reauthentication: {
    subject: 'Verify it’s you on Horace',
    heading: 'Quick security check',
    body: `Tap the button below to confirm it’s you. The link expires in 10 minutes.`,
    cta: 'Confirm sign-in',
  },
}

/**
 * Optional context for the `invite` action. When provided, the subject/body
 * are interpolated with workspace + inviter + role so the recipient knows
 * who, where, and as what. Falls back to the generic invite copy when omitted
 * (so the Supabase Auth webhook caller — which uses the built-in `invite`
 * action — still works unchanged).
 */
export interface WorkspaceInviteContext {
  workspaceName: string
  inviterName: string
  /** agents.role vocabulary — 'manager' or 'agent'. */
  role: 'manager' | 'agent'
}

export function buildMagicLinkEmail(args: {
  action: MagicLinkAction
  url: string
  email: string
  inviteContext?: WorkspaceInviteContext
}): { subject: string; html: string } {
  let { subject, heading, body, cta } = MAGIC_COPY[args.action] ?? MAGIC_COPY.magiclink

  let preheader = ''

  if (args.action === 'invite' && args.inviteContext) {
    const { workspaceName, inviterName, role } = args.inviteContext
    const firstName = inviterName.split(/\s+/)[0] || inviterName
    const roleLabel = role === 'manager' ? 'a manager' : 'an agent'
    subject = `${firstName} invited you to ${workspaceName} on Horace`
    heading = `Join ${workspaceName} on Horace`
    body = `${inviterName} invited you to join ${workspaceName} as ${roleLabel}.`
    cta = 'Accept invitation'
    preheader = 'Tap to accept and sign in — link expires in 7 days.'
  }

  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</div>`
    : ''

  // Auth emails are operational — always sign as the team, never as Horace.
  const signOffHtml = `<p style="margin:24px 0 0;font-size:13px;color:${T.charcoal};line-height:1.6;">— The Horace team</p>`

  const bodyContent = `
    ${preheaderHtml}
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${T.ink};letter-spacing:-0.02em;">${heading}</p>
    <p style="margin:0 0 24px;font-size:14px;color:${T.stone};line-height:1.6;">${body}</p>
    <a href="${args.url}" style="display:inline-block;background:${T.ink};color:${T.cream};text-decoration:none;font-size:13px;font-weight:600;padding:12px 26px;border-radius:6px;">${cta} →</a>
    <p style="margin:24px 0 0;font-size:12px;color:${T.stone};line-height:1.6;">
      Or paste this link into your browser:<br>
      <a href="${args.url}" style="color:${T.terracotta};text-decoration:none;word-break:break-all;">${args.url}</a>
    </p>
    ${signOffHtml}
    <div style="height:20px;"></div>
  `

  const footerContent = `
    <p style="margin:0;font-size:11px;color:${T.stone};line-height:1.5;">
      Sent to ${args.email}. If you didn’t request this, you can ignore this email — the link will expire on its own.
    </p>
  `

  return { subject, html: shell(bodyContent, footerContent) }
}

/**
 * Plain-text fallback for the invite email. Useful for clients that don't
 * render HTML (or for unit-test assertions). HOR-99's send path can pass
 * this alongside the HTML when calling Resend's `text` field.
 *
 * Intentionally minimal — no styling, no tables, just the human content.
 */
export function buildInvitePlainText(args: {
  url: string
  inviteContext: WorkspaceInviteContext
}): string {
  const { workspaceName, inviterName, role } = args.inviteContext
  const roleLabel = role === 'manager' ? 'a manager' : 'an agent'
  return [
    `${inviterName} invited you to join ${workspaceName} on Horace as ${roleLabel}.`,
    '',
    `Accept the invitation: ${args.url}`,
    '',
    'The link expires in 7 days. If you didn’t expect this, you can ignore the email.',
    '',
    '— The Horace team',
  ].join('\n')
}
