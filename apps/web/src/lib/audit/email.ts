/**
 * The "send it to me" email — fired when an agent leaves their address on the
 * report. Plain, warm HTML in Horace's voice, from team@gohorace.com (matching
 * the welcome email's sender convention).
 *
 * v1 sends the findings summary inline + links to the playbook and a
 * walk-through. The full PDF render is a deliberate follow-up — the email is
 * still useful on its own, and the report stays valuable even if it never
 * arrives.
 */

import type { AuditResult, Band } from './types'

const PLAYBOOK_URL = 'https://www.gohorace.com/manifesto'
const BOOK_URL = 'https://www.gohorace.com/contact'

const BAND_LABEL: Record<Band, string> = {
  fix: 'Fix this first',
  watch: 'Worth a look',
  good: 'Looking good',
}
const BAND_COLOR: Record<Band, string> = {
  fix: '#C4622D',
  watch: '#B5922A',
  good: '#3D5246',
}

export function buildAuditReportEmail(args: { domain: string; result?: AuditResult }): {
  subject: string
  html: string
  text: string
} {
  const { domain, result } = args
  const subject = `What I found on ${domain}`

  const findings = result?.findings ?? []
  const verdict = result?.verdict

  const findingRows = findings
    .map(
      (f) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid rgba(140,123,107,0.2);vertical-align:top;">
          <div style="font:600 16px/1.3 'Helvetica Neue',Arial,sans-serif;color:#1A1612;">${escapeHtml(
            f.name,
          )}
            <span style="font:600 11px/1 'Helvetica Neue',Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:${
              BAND_COLOR[f.band]
            };margin-left:8px;">${BAND_LABEL[f.band]}</span>
          </div>
          <div style="font:400 14px/1.6 'Helvetica Neue',Arial,sans-serif;color:#6E5F50;margin-top:6px;">${escapeHtml(
            f.body,
          )}</div>
        </td>
      </tr>`,
    )
    .join('')

  const verdictLine = verdict
    ? `${verdict.solid} of the five ${verdict.solid === 1 ? 'is' : 'are'} solid. ${
        verdict.work
      } could use some work.`
    : ''

  const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#F5F0E8;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#FAF7F2;border-radius:12px;padding:36px 32px;">
    <p style="font:italic 500 22px/1.3 Georgia,serif;color:#1A1612;margin:0 0 8px;">I had a look at ${escapeHtml(
      domain,
    )}.</p>
    ${
      verdictLine
        ? `<p style="font:400 15px/1.6 'Helvetica Neue',Arial,sans-serif;color:#6E5F50;margin:0 0 24px;">${verdictLine} Here's the short version — the playbook below goes deeper on each one.</p>`
        : `<p style="font:400 15px/1.6 'Helvetica Neue',Arial,sans-serif;color:#6E5F50;margin:0 0 24px;">Here's the short version — the playbook below goes deeper on each one.</p>`
    }
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${findingRows}</table>
    <div style="margin-top:32px;">
      <a href="${BOOK_URL}" style="display:inline-block;background:#C4622D;color:#FAF7F2;text-decoration:none;font:500 15px/1 'Helvetica Neue',Arial,sans-serif;padding:14px 24px;border-radius:10px;">Book a walk-through</a>
      <a href="${PLAYBOOK_URL}" style="display:inline-block;color:#1A1612;text-decoration:none;font:500 15px/1 'Helvetica Neue',Arial,sans-serif;padding:14px 18px;">Read the playbook</a>
    </div>
    <p style="font:italic 400 15px/1.5 Georgia,serif;color:#8C7B6B;margin:32px 0 0;">Seize the moment — Horace</p>
  </div>
</body></html>`

  const text = [
    `I had a look at ${domain}.`,
    verdictLine,
    '',
    ...findings.map((f) => `${f.name} — ${BAND_LABEL[f.band]}\n${f.body}`),
    '',
    `Read the playbook: ${PLAYBOOK_URL}`,
    `Book a walk-through: ${BOOK_URL}`,
    '',
    'Seize the moment — Horace',
  ]
    .filter((l) => l !== undefined)
    .join('\n')

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
