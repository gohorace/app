export interface BriefingLead {
  contact_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  score: number
  score_change: number
  event_count: number
  last_seen_at: string | null
}

export function buildWeeklyBriefingEmail(
  orgName: string,
  leads: BriefingLead[],
  appUrl: string,
): { subject: string; html: string } {
  const subject = `Your weekly leads briefing — ${orgName}`
  const topScore = leads[0]?.score_change ?? 0

  const leadsHtml = leads.length === 0
    ? `<p style="color:#6b7280;font-size:14px;">No lead activity in the last 7 days.</p>`
    : leads.map((lead) => {
        const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown'
        const profileUrl = `${appUrl}/leads/${lead.contact_id}`
        const scoreColor = lead.score >= 50 ? '#16a34a' : lead.score >= 20 ? '#2563eb' : '#6b7280'
        const changeText = lead.score_change > 0 ? `+${lead.score_change} this week` : 'No change'
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
              <a href="${profileUrl}" style="font-weight:600;color:#111827;text-decoration:none;font-size:14px;">${name}</a>
              ${lead.email ? `<br><span style="color:#6b7280;font-size:12px;">${lead.email}</span>` : ''}
            </td>
            <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;text-align:center;">
              <span style="font-weight:700;font-size:18px;color:${scoreColor};">${lead.score}</span>
            </td>
            <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;font-size:13px;">
              ${changeText}<br>${lead.event_count} event${lead.event_count === 1 ? '' : 's'}
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
            <p style="margin:0;color:#f9fafb;font-size:18px;font-weight:700;">RE Insights</p>
            <p style="margin:4px 0 0;color:#9ca3af;font-size:13px;">Weekly briefing for ${orgName}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;color:#111827;font-size:22px;font-weight:700;">
              ${leads.length > 0 ? `${leads.length} active lead${leads.length === 1 ? '' : 's'} this week` : 'Your weekly summary'}
            </p>
            ${leads.length > 0 && topScore > 0
              ? `<p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Top mover gained <strong style="color:#111827;">+${topScore} points</strong> in the last 7 days.</p>`
              : `<p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Here's a summary of your lead activity.</p>`
            }

            <table width="100%" cellpadding="0" cellspacing="0">
              <thead>
                <tr>
                  <th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">Contact</th>
                  <th style="text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;padding-bottom:8px;border-bottom:1px solid #e5e7eb;padding-left:16px;">Score</th>
                  <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">Activity</th>
                </tr>
              </thead>
              <tbody>${leadsHtml}</tbody>
            </table>

            <div style="margin-top:24px;text-align:center;">
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
              You're receiving this because you set up weekly briefings in RE Insights.
              <a href="${appUrl}/settings/notifications" style="color:#6b7280;">Manage preferences</a>
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
