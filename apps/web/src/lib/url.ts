/**
 * Resolve the deploy's own URL. On Vercel preview/dev deploys, NEXT_PUBLIC_APP_URL
 * is typically set to the production URL — we want the actual deploy URL so
 * minted links (MCP endpoint, unsubscribe, short links) don't point at prod.
 *
 * Server-only: VERCEL_URL is not exposed to the browser.
 */
export function getAppUrl(): string {
  const env = process.env.VERCEL_ENV
  if ((env === 'preview' || env === 'development') && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? ''
}
