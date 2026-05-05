import type { LeadWithInsight } from '@/lib/ai/briefing'

export type { LeadWithInsight }

export type AlertEmailType = 'return_visit' | 'form_submit' | 'score_threshold'

export function buildAlertEmail(
  type: AlertEmailType,
  contactName: string,
  contactId: string,
  appUrl: string,
  extra?: { score?: number; formName?: string | null },
): { subject: string; html: string } {
  const profileUrl = `${appUrl}/leads/${contactId}`
  const firstName = contactName.split(' ')[0]

  const content: Record<AlertEmailType, { subject: string; heading: string; body: string; cta: string }> = {
    return_visit: {
      subject: `${firstName} is back on your site`,
      heading: `${contactName} just returned`,
      body: `They're browsing your site right now. This might be a good time to reach out while you're top of mind.`,
      cta: 'View their activity',
    },
    form_submit: {
      subject: `${firstName} submitted a form`,
      heading: `${contactName} raised their hand`,
      body: `They just submitted${extra?.formName ? ` "${extra.formName}"` : ' a form'} on your website. Worth a follow-up now while the lead is warm.`,
      cta: 'View contact',
    },
    score_threshold: {
      subject: `${firstName} just crossed your intent threshold`,
      heading: `Hot prospect — score ${extra?.score ?? ''}`,
      body: `${contactName} has been actively engaging with your site and just crossed your alert threshold. Now's the time to act.`,
      cta: 'View contact',
    },
  }

  const { subject, heading, body, cta } = content[type]

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F2EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#FDFAF5;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <tr>
          <td style="background:#2E2823;padding:20px 32px;">
            <p style="margin:0;color:#F5F2EC;font-size:17px;font-weight:700;letter-spacing:-0.01em;">Horace</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;color:#1A1612;font-size:22px;font-weight:700;letter-spacing:-0.02em;">${heading}</p>
            <p style="margin:0 0 24px;color:#6B5E54;font-size:15px;line-height:1.6;">${body}</p>
            <a href="${profileUrl}" style="display:inline-block;background:#C4622D;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 22px;border-radius:6px;">${cta} →</a>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 32px;border-top:1px solid #EDE8E0;">
            <p style="margin:0;color:#9B8E86;font-size:12px;">
              <a href="${appUrl}/settings/notifications" style="color:#9B8E86;">Manage alert preferences</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html }
}

export function buildWeeklyBriefingEmail(
  agentName: string,
  leads: LeadWithInsight[],
  appUrl: string,
): { subject: string; html: string } {
  const subject = `Your weekly brief — ${leads.length} lead${leads.length === 1 ? '' : 's'} to act on`

  const leadsHtml = leads.length === 0
    ? `<p style="color:#6b7280;font-size:14px;">No lead activity in the last 7 days.</p>`
    : leads.map((lead, i) => {
        const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown'
        const profileUrl = `${appUrl}/leads/${lead.contact_id}`
        const scoreColor = lead.score >= 50 ? '#16a34a' : lead.score >= 20 ? '#2563eb' : '#6b7280'
        const changeText = lead.score_change > 0 ? `+${lead.score_change} pts this week` : 'No change'
        const isTop = i === 0

        return `
          <tr>
            <td style="padding:20px 0;border-bottom:1px solid #f3f4f6;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    ${isTop ? `<span style="display:inline-block;background:#fef9c3;color:#854d0e;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:2px 8px;border-radius:4px;margin-bottom:6px;">Top priority</span><br>` : ''}
                    <a href="${profileUrl}" style="font-weight:700;color:#111827;text-decoration:none;font-size:15px;">${name}</a>
                    ${lead.email ? `<span style="color:#6b7280;font-size:13px;"> · ${lead.email}</span>` : ''}
                  </td>
                  <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:16px;">
                    <span style="font-weight:700;font-size:20px;color:${scoreColor};">${lead.score}</span>
                    <br><span style="color:#6b7280;font-size:12px;">${changeText}</span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:10px;">
                    <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.5;">
                      ${lead.insight.why_now}
                    </p>
                    <div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;border-radius:0 4px 4px 0;">
                      <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">→ ${lead.insight.action}</p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:10px;">
                    <a href="${profileUrl}" style="color:#6b7280;font-size:12px;text-decoration:underline;">View full profile</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      }).join('')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:#111827;padding:24px 32px;">
            <p style="margin:0;color:#f9fafb;font-size:18px;font-weight:700;">Horace</p>
            <p style="margin:4px 0 0;color:#9ca3af;font-size:13px;">Weekly brief for ${agentName}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 6px;color:#111827;font-size:22px;font-weight:700;">
              ${leads.length > 0 ? `${leads.length} contact${leads.length === 1 ? '' : 's'} worth your attention` : 'Your weekly summary'}
            </p>
            <p style="margin:0 0 28px;color:#6b7280;font-size:14px;">
              ${leads.length > 0
                ? `Here's who to focus on this week and why — with a suggested action for each.`
                : `No lead activity in the last 7 days.`}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0">
              <tbody>${leadsHtml}</tbody>
            </table>

            <div style="margin-top:28px;text-align:center;">
              <a href="${appUrl}/leads" style="display:inline-block;background:#111827;color:#f9fafb;text-decoration:none;font-size:14px;font-weight:600;padding:10px 24px;border-radius:6px;">
                View all leads
              </a>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Seize the moment · <a href="${appUrl}/settings/notifications" style="color:#6b7280;">Manage preferences</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html }
}
