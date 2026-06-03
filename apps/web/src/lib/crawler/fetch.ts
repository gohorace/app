/**
 * Crawler fetch primitive — HOR-385.
 *
 * Same guards as the onboarding site-probe (HoraceBot UA, hard timeout, body
 * cap) but returns the HTTP status instead of throwing on >= 400, because the
 * crawler records `last_http_status` rather than aborting. A single bad page
 * must never throw the whole crawl tick, so network failures resolve to
 * `{ ok: false, status: 0 }` rather than rejecting.
 */

export const CRAWLER_UA = 'HoraceBot/1.0 (+https://gohorace.com)'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_BODY_CAP_BYTES = 2_097_152 // 2 MiB

export interface FetchResult {
  ok: boolean
  status: number
  html: string
  finalUrl: string
  contentType: string
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (bytes >= cap) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  out += decoder.decode()
  return out
}

export async function fetchPage(
  url: string | URL,
  opts: { timeoutMs?: number; bodyCap?: number; accept?: string } = {},
): Promise<FetchResult> {
  const target = String(url)
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': CRAWLER_UA,
        Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    const status = res.status
    const contentType = res.headers.get('content-type') ?? ''
    const finalUrl = res.url || target
    if (status >= 400) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, status, html: '', finalUrl, contentType }
    }
    const html = await readCapped(res, opts.bodyCap ?? DEFAULT_BODY_CAP_BYTES)
    return { ok: true, status, html, finalUrl, contentType }
  } catch {
    // Timeout / DNS / connection reset — record as unreachable, don't throw.
    return { ok: false, status: 0, html: '', finalUrl: target, contentType: '' }
  } finally {
    clearTimeout(timeout)
  }
}

/** Run `worker` over `items` with bounded concurrency. Results preserve input
 *  order; a rejected worker resolves to `null` in its slot so one bad page
 *  never sinks the batch. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) break
      try {
        results[i] = await worker(items[i], i)
      } catch {
        results[i] = null
      }
    }
  })
  await Promise.all(runners)
  return results
}
