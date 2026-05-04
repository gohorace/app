/**
 * Real Estate Insights Tracker
 * Lightweight first-party analytics snippet for lead identity resolution.
 *
 * Usage:
 *   <script>window.RIQ = { key: 'org-slug', propertyPattern: '/property/' }</script>
 *   <script src="tracker.min.js" async></script>
 */

interface RIQConfig {
  key: string
  propertyPattern?: string
  captureEmail?: boolean
  apiUrl?: string
  debug?: boolean
  email?: string  // pre-set on thank-you pages via merge tags e.g. window.RIQ.email = '{{contact.email}}'
  identify?: (email: string, source?: string, formId?: string | null) => void
}

interface EventPayload {
  t: string
  p: Record<string, unknown>
  ts: number
}

interface TrackPayload {
  k: string
  aid: string
  sid: string
  events: EventPayload[]
  s?: {
    ctoken?: string
    utm_source?: string | null
    utm_medium?: string | null
    utm_campaign?: string | null
    utm_content?: string | null
    referrer?: string | null
    is_return?: boolean
    ua?: string
  }
}

declare global {
  interface Window {
    RIQ?: RIQConfig
  }
}

;(function () {
  function init() {
    const config: RIQConfig = window.RIQ || ({} as RIQConfig)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function log(...args: any[]): void {
      if (config.debug) console.log('[RIQ]', ...args)
    }

    if (!config.key) {
      // Config not ready yet — retry once after DOM is parsed
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true })
      } else {
        console.warn('[RIQ] No key set — tracking disabled. Set window.RIQ.key to your org slug.')
      }
      return
    }

  const API_URL = config.apiUrl || '/api'
  const COOKIE_AID = '_riq_aid'
  const COOKIE_SID = '_riq_sid'
  const STORAGE_CTOKEN = '_riq_ctoken'
  const SESSION_MS = 30 * 60 * 1000 // 30 minutes

  log('Initialised', { key: config.key, apiUrl: API_URL, propertyPattern: config.propertyPattern })

  // ─── Cookie helpers ──────────────────────────────────────────────────────────

  function getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }

  function setCookie(name: string, value: string, maxAge: number): void {
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
  }

  // ─── ID generation ───────────────────────────────────────────────────────────

  function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  // ─── Anonymous ID (persists 1 year) ──────────────────────────────────────────

  let existingAid = getCookie(COOKIE_AID)
  const isReturnVisit = !!existingAid

  if (!existingAid) {
    existingAid = generateId()
    setCookie(COOKIE_AID, existingAid, 365 * 24 * 3600)
    log('New visitor — anonymous ID created:', existingAid)
  } else {
    log('Returning visitor — anonymous ID:', existingAid)
  }
  const anonymousId = existingAid

  // ─── Session ID (expires after 30 min of inactivity) ─────────────────────────

  function getOrCreateSessionId(): string {
    const existing = getCookie(COOKIE_SID)
    if (existing) {
      // Refresh session expiry on activity
      setCookie(COOKIE_SID, existing, SESSION_MS / 1000)
      return existing
    }
    const newSid = generateId()
    setCookie(COOKIE_SID, newSid, SESSION_MS / 1000)
    return newSid
  }

  const sessionId = getOrCreateSessionId()
  const isNewSession = !getCookie(COOKIE_SID) || getCookie(COOKIE_SID) !== sessionId

  // ─── URL params capture ───────────────────────────────────────────────────────

  function getParam(name: string): string | null {
    return new URLSearchParams(location.search).get(name)
  }

  // Campaign token — persist for the session
  const ctokenFromUrl = getParam('_ri')
  if (ctokenFromUrl) {
    try {
      sessionStorage.setItem(STORAGE_CTOKEN, ctokenFromUrl)
    } catch (_) {}
  }
  const campaignToken = (() => {
    try {
      return sessionStorage.getItem(STORAGE_CTOKEN)
    } catch (_) {
      return null
    }
  })()

  // UTM params — only capture on new sessions
  const sessionMeta =
    isNewSession || ctokenFromUrl
      ? {
          ctoken: campaignToken || undefined,
          utm_source: getParam('utm_source'),
          utm_medium: getParam('utm_medium'),
          utm_campaign: getParam('utm_campaign'),
          utm_content: getParam('utm_content'),
          referrer: document.referrer || null,
          is_return: isReturnVisit,
          ua: navigator.userAgent,
        }
      : { ctoken: campaignToken || undefined }

  // ─── Event queue and flush ────────────────────────────────────────────────────

  const queue: EventPayload[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush(beacon = false): void {
    if (queue.length === 0) return
    const events = queue.splice(0)

    const payload: TrackPayload = {
      k: config.key,
      aid: anonymousId,
      sid: sessionId,
      events,
      s: sessionMeta,
    }

    const body = JSON.stringify(payload)
    const url = `${API_URL}/t`

    log(`Flushing ${events.length} event(s) to ${url}`, events.map((e) => e.t))

    if (beacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      log('Sent via sendBeacon')
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
      })
        .then((r) => log(`/api/t response: ${r.status} ${r.statusText}`))
        .catch((err) => log('Fetch error:', err))
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => flush(), 10_000)
  }

  function track(eventType: string, props: Record<string, unknown> = {}): void {
    log(`Queued event: ${eventType}`, props)
    queue.push({ t: eventType, p: props, ts: Date.now() })
    if (queue.length >= 10) {
      if (flushTimer) clearTimeout(flushTimer)
      flush()
    } else {
      scheduleFlush()
    }
  }

  // Flush on tab close / background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })

  // ─── Page view ────────────────────────────────────────────────────────────────

  const url = location.href
  const title = document.title

  const isPropertyPage =
    config.propertyPattern && location.pathname.includes(config.propertyPattern)

  track(isPropertyPage ? 'property_view' : 'page_view', { url, title })

  // Return visit event (fires once per new session for known visitors)
  if (isReturnVisit && !getCookie(COOKIE_SID + '_rv')) {
    track('return_visit', { url })
    setCookie(COOKIE_SID + '_rv', '1', SESSION_MS / 1000)
  }

  // ─── Scroll depth ─────────────────────────────────────────────────────────────

  const scrollThresholds = [25, 50, 75, 90]
  const firedScrollDepths = new Set<number>()

  function checkScrollDepth(): void {
    const scrolled = window.scrollY + window.innerHeight
    const total = document.documentElement.scrollHeight
    if (total <= window.innerHeight) return // page doesn't scroll

    const pct = Math.round((scrolled / total) * 100)
    for (const threshold of scrollThresholds) {
      if (pct >= threshold && !firedScrollDepths.has(threshold)) {
        firedScrollDepths.add(threshold)
        track('scroll_depth', { pct: threshold, url })
      }
    }
  }

  let scrollTicking = false
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        checkScrollDepth()
        scrollTicking = false
      })
      scrollTicking = true
    }
  }, { passive: true })

  // ─── Identity resolution core ─────────────────────────────────────────────────

  interface ContactMeta {
    first_name?: string
    last_name?: string
    phone?: string
  }

  let lastIdentifiedEmail = ''

  function identify(email: string, source: string, formId?: string | null, meta?: ContactMeta): void {
    const e = email.trim().toLowerCase()
    if (!e || !e.includes('@')) return
    if (e === lastIdentifiedEmail) return // deduplicate within page
    lastIdentifiedEmail = e

    log(`Identity captured via ${source}:`, e, meta ?? {})
    track('form_submit', { url, form_id: formId ?? null, source })

    fetch(`${API_URL}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: config.key, aid: anonymousId, sid: sessionId, email: e, meta }),
      keepalive: true,
      credentials: 'omit',
    })
      .then((r) => log(`/api/identity response: ${r.status} ${r.statusText}`))
      .catch((err) => log('Identity fetch error:', err))
  }

  // ─── Helpers: extract name + phone from form fields ──────────────────────────

  function extractMeta(fields: Array<{ name?: string; title?: string; value: string; type?: string }>): ContactMeta {
    const meta: ContactMeta = {}
    let fullName: string | undefined

    for (const f of fields) {
      // Check both name attr/id AND label/title — Elementor uses auto-generated IDs
      // like form_field_0 so we must also check the human-readable title
      const keys = [(f.name ?? '').toLowerCase(), (f.title ?? '').toLowerCase()].filter(Boolean)
      const val = (f.value ?? '').trim()
      if (!val) continue

      const matches = (patterns: string[]) => keys.some((k) => patterns.some((p) => k === p))
      const includes = (substrings: string[]) => keys.some((k) => substrings.some((s) => k.includes(s)))

      if (!meta.first_name && matches(['first_name', 'first-name', 'firstname', 'first name'])) {
        meta.first_name = val
      } else if (!meta.last_name && matches(['last_name', 'last-name', 'lastname', 'last name', 'surname'])) {
        meta.last_name = val
      } else if (!fullName && matches(['name', 'full_name', 'fullname', 'full name', 'your name'])) {
        fullName = val
      } else if (!meta.phone && (f.type === 'tel' || includes(['phone', 'mobile', 'tel']))) {
        meta.phone = val
      }
    }

    // Split "Full Name" into first/last if dedicated fields weren't found
    if (fullName && !meta.first_name) {
      const parts = fullName.split(/\s+/)
      meta.first_name = parts[0]
      if (parts.length > 1) meta.last_name = parts.slice(1).join(' ')
    }

    return meta
  }

  // ─── Manual API: window.RIQ.identify(email) ──────────────────────────────────
  // Agents can call this from any form callback:
  //   window.addEventListener('form-success', e => window.RIQ.identify(e.detail.email))
  if (window.RIQ) window.RIQ.identify = identify.bind(null, 'manual', null)

  // ─── Thank-you page detection ─────────────────────────────────────────────────

  // 1. window.RIQ.email — set via server-side merge tags on the thank-you page template
  if (config.email) {
    identify(config.email, 'config-prefill')
  }

  // 2. sessionStorage handoff — works with HighLevel and any iframe form.
  //    In the form's post-submit custom JS, store the email before redirect:
  //      var e = document.querySelector('input[type="email"]');
  //      if (e) sessionStorage.setItem('_riq_pending_email', e.value);
  //    The tracker picks it up on the thank-you page and clears it.
  if (!lastIdentifiedEmail) {
    try {
      const pending = sessionStorage.getItem('_riq_pending_email')
      if (pending) {
        sessionStorage.removeItem('_riq_pending_email')
        identify(pending, 'sessionstorage-handoff')
      }
    } catch (_) {}
  }

  // ─── Form email capture ───────────────────────────────────────────────────────

  if (config.captureEmail !== false) {

    // 1. Native HTML form submit
    document.addEventListener('submit', (e: Event) => {
      const form = e.target as HTMLFormElement
      if (!form || form.tagName !== 'FORM') return
      const emailInput =
        (form.querySelector('input[type="email"]') as HTMLInputElement) ||
        (form.querySelector('input[name*="email"]') as HTMLInputElement) ||
        (form.querySelector('input[name*="Email"]') as HTMLInputElement)
      if (!emailInput?.value) return
      const inputs = Array.from(form.querySelectorAll('input, textarea, select')) as HTMLInputElement[]
      const meta = extractMeta(inputs.map((i) => {
        const label = i.id
          ? document.querySelector('label[for="' + i.id + '"]')?.textContent?.trim()
          : undefined
        return { name: i.name, title: label, value: i.value, type: i.type }
      }))
      identify(emailInput.value, 'form-submit', form.id || form.getAttribute('name'), meta)
    })

    // 2. PostMessage — catches HighLevel, Typeform, and other iframe forms
    window.addEventListener('message', (e: MessageEvent) => {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
        if (!d || typeof d !== 'object') return

        // HighLevel: { type: 'form-submitted', data: { email } }
        //            { type: 'FORM_SUBMITTED', formData: { email } }
        // Typeform:  { type: 'form-submit', response_id, ... }
        const email =
          d?.data?.email ||
          d?.formData?.email ||
          d?.payload?.email ||
          d?.email ||
          null

        if (email) identify(email, 'postmessage-' + (d.type ?? 'unknown'))
      } catch (_) {}
    })

    // 3. WordPress / common plugin events
    // Contact Form 7
    document.addEventListener('wpcf7mailsent', (e: Event) => {
      const detail = (e as CustomEvent).detail
      const email = detail?.inputs?.find((i: {name: string; value: string}) =>
        i.name.toLowerCase().includes('email'))?.value
      if (email) identify(email, 'cf7', detail?.unitId)
    })

    // Gravity Forms
    document.addEventListener('gform_confirmation_loaded', (e: Event) => {
      const formId = (e as CustomEvent).detail?.formId
      // GF doesn't expose email in the event — fall back to reading the last filled input
      const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement
      if (emailInput?.value) identify(emailInput.value, 'gravityforms', formId)
    })

    // Elementor forms
    document.addEventListener('elementorFormSubmitSuccess', (e: Event) => {
      const detail = (e as CustomEvent).detail
      const fields: Array<{id: string; title?: string; value: string}> = detail?.data?.fields ?? []
      // Elementor only sends field id + value in the event — look up the visible
      // label from the DOM so extractMeta can match "Name", "Phone" etc.
      const enriched = fields.map((f) => {
        const inputEl = document.getElementById('form-field-' + f.id)
        const label = inputEl
          ? document.querySelector('label[for="' + inputEl.id + '"]')?.textContent?.trim()
          : undefined
        return { name: f.id, title: f.title ?? label, value: f.value }
      })
      const emailField = enriched.find((f) =>
        f.name.toLowerCase().includes('email') || f.title?.toLowerCase().includes('email'))
      if (!emailField?.value) return
      const meta = extractMeta(enriched)
      identify(emailField.value, 'elementor', detail?.data?.id ?? null, meta)
    })

    // Ninja Forms
    document.addEventListener('nfFormSubmitResponse', (e: Event) => {
      const fields: Record<string, {value: string; type: string}> =
        (e as CustomEvent).detail?.response?.data?.fields ?? {}
      const emailField = Object.values(fields).find((f) => f.type === 'email')
      if (emailField?.value) identify(emailField.value, 'ninjaforms')
    })
  }
  } // end init

  init()
})()
