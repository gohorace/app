/**
 * web-push's `setVapidDetails(subject, …)` requires the subject to be a
 * `mailto:` or `http(s):` URL and throws "Vapid subject is not a url or mailto
 * url" otherwise. Operators routinely set `VAPID_EMAIL` to a bare address
 * (e.g. `hello@gohorace.com`), which made every send throw an unhandled 500
 * — both the "Send test" button and real alert dispatch (HOR-296).
 *
 * Normalise whatever's configured into a valid subject: pass URLs/mailto
 * through untouched, prefix a bare address with `mailto:`, and fall back to
 * the support address when unset.
 */
export function vapidSubject(raw: string | undefined = process.env.VAPID_EMAIL): string {
  const v = raw?.trim()
  if (!v) return 'mailto:hello@gohorace.com'
  if (/^(mailto:|https?:\/\/)/i.test(v)) return v
  return `mailto:${v}`
}
