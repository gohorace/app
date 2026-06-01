import 'server-only'

/**
 * Render a timestamp as the postgres timestamptz form the substrate shows,
 * e.g. `2026-06-01 10:52:00+10`, in Australia/Sydney (AU agents, AU data
 * residency). Zero-padded so lexical sort matches chronological sort.
 * Returns null for null/invalid input — the table renders that as `null`.
 */
export function formatTimestamptz(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  const tz = 'Australia/Sydney'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>

  const hour = parts.hour === '24' ? '00' : parts.hour
  const offRaw = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+10'
  const off = offRaw.replace('GMT', '').replace(':00', '') || '+0'

  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}${off}`
}
