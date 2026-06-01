/* Horace reference tables — STUB data (deterministic).
 *
 * UI-first phase: this mirrors the design-handoff mock generator (data.js)
 * so the substrate tables render with realistic rows. It is deterministic
 * (seeded PRNG, fixed clock) so server and client render identically — no
 * hydration mismatch, no `Date.now()`.
 *
 * REPLACE ME: when wiring real data, delete this file and feed
 * `ContactRow[]` / `PropertyRow[]` from a server-paginated query
 * (sort + filter + limit/offset + total count). The table components
 * already accept the rows as props, so only the page-level data source
 * changes. */

import type { ContactRow, PropertyRow, SignalValue } from './types'

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HEX = '0123456789abcdef'

function makeUuid(rnd: () => number): string {
  let s = ''
  for (let i = 0; i < 32; i++) {
    if (i === 12) { s += '4'; continue }
    if (i === 16) { s += HEX[Math.floor(rnd() * 4) + 8]; continue }
    s += HEX[Math.floor(rnd() * 16)]
  }
  return (
    s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' +
    s.slice(16, 20) + '-' + s.slice(20)
  )
}

// postgres-style timestamptz: `2026-05-29 08:14:55+10`. Fixed reference
// clock (1 Jun 2026 11:12 +10) keeps output stable across renders.
function ts(minsAgo: number): string {
  const now = Date.UTC(2026, 5, 1, 1, 12, 0)
  const d = new Date(now - minsAgo * 60000)
  const p = (n: number) => String(n).padStart(2, '0')
  const syd = new Date(d.getTime() + 10 * 3600000)
  return (
    `${syd.getUTCFullYear()}-${p(syd.getUTCMonth() + 1)}-${p(syd.getUTCDate())} ` +
    `${p(syd.getUTCHours())}:${p(syd.getUTCMinutes())}:${p(syd.getUTCSeconds())}+10`
  )
}

const SIGNAL_WEIGHTS: Array<[SignalValue, number]> = [
  ['high intent', 9],
  ['serious buyer', 12],
  ['pre-appraisal', 16],
  ['benchmarking', 22],
  ['watching', 41],
]

function weightedSignal(rnd: () => number): SignalValue {
  const total = SIGNAL_WEIGHTS.reduce((a, [, w]) => a + w, 0)
  let r = rnd() * total
  for (const [s, w] of SIGNAL_WEIGHTS) {
    if ((r -= w) <= 0) return s
  }
  return 'watching'
}

function intentFor(sig: SignalValue, rnd: () => number): number {
  const base: Record<SignalValue, number> = {
    'high intent': 78,
    'serious buyer': 62,
    'pre-appraisal': 47,
    'benchmarking': 29,
    'watching': 12,
  }
  return Math.max(0, Math.min(99, base[sig] + Math.floor((rnd() - 0.5) * 22)))
}

const FIRST = ['Sarah', 'David', 'Claire', 'Marcus', 'Priya', 'Tom', 'Olivia', 'Hugo', 'Mei', 'Daniel', 'Amara', 'Leo', 'Grace', 'Raj', 'Hannah', 'Ethan', 'Yuki', 'Noah', 'Sofia', 'Liam', 'Aisha', 'Ben', 'Chloe', 'Omar', 'Isla', 'Felix', 'Nadia', 'Sam', 'Zara', 'Jack', 'Eleni', 'Theo', 'Rosa', 'Kai', 'Maya', 'Adam', 'Lucia', 'Finn', 'Tara', 'Will', 'Anika', 'Cole', 'Bea', 'Dev', 'Esme', 'Gus', 'Nina', 'Reuben', 'Tess', 'Vik']
const LAST = ['Thompson', 'Nguyen', 'Adeyemi', 'Bell', 'Sharma', "O'Brien", 'Caruso', 'Walsh', 'Tan', 'Reid', 'Okafor', 'Moretti', 'Lin', 'Petrov', 'Hughes', 'Brooks', 'Kowalski', 'Mendez', 'Patel', 'Doyle', 'Fraser', 'Iqbal', 'Romano', 'Chen', 'Murphy', 'Sato', 'Khan', 'Webb', 'Lowe', 'Bianchi', 'Ferris', 'Holt', 'Yates', 'Mara', 'Dunn', 'Esposito', 'Vance', 'Pike', 'Roy', 'Hale', 'Bauer', 'Quinn', 'Sloan', 'Greer', 'Marsh', 'Cole', 'Voss', 'Reyes', 'Tully', 'Wren']
const SUBURBS = ['Paddington', 'Surry Hills', 'Newtown', 'Glebe', 'Leichhardt', 'Balmain', 'Redfern', 'Annandale', 'Erskineville', 'Marrickville', 'Stanmore', 'Rozelle', 'Camperdown', 'Darlinghurst', 'Enmore', 'Petersham', 'Lilyfield', 'Bondi', 'Coogee', 'Waverley']
const STREETS = ['Maple', 'Cascade', 'Norton', 'Trafalgar', 'Edgeware', 'Albion', 'Cardigan', 'Probert', 'Brown', 'Cooper', 'Wigram', 'Mansfield', 'Llewellyn', 'Booth', 'Goodsell', 'Australia', 'Denison', 'Fitzroy', 'Regent', 'Wells', 'Salisbury', 'Carlton', 'Bedford', 'Holt', 'Renwick']
const STYPE = ['St', 'Rd', 'Ave', 'Pl', 'Tce', 'Ln', 'Cres']
const DOMAINS = ['gmail.com', 'outlook.com', 'bigpond.com', 'me.com', 'icloud.com', 'work.com.au']

export function makeStubContacts(count = 124): ContactRow[] {
  const rnd = mulberry32(0x484f5241) // "HORA"
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const usedNames = new Set<string>()
  const rows: Array<ContactRow & { _mins: number }> = []
  for (let i = 0; i < count; i++) {
    let name = ''
    let guard = 0
    do { name = `${pick(FIRST)} ${pick(LAST)}`; guard++ } while (usedNames.has(name) && guard < 8)
    usedNames.add(name)
    const sig = weightedSignal(rnd)
    const minsAgo = Math.floor(Math.pow(rnd(), 1.7) * 20160) // up to ~14d, skewed recent
    const handle = name.toLowerCase().replace(/[^a-z]+/g, '.')
    rows.push({
      id: makeUuid(rnd),
      name,
      email: rnd() < 0.17 ? null : `${handle}@${pick(DOMAINS)}`,
      intent: intentFor(sig, rnd),
      signal: sig,
      sessions_7d: sig === 'watching' ? 1 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 7),
      last_seen: '',
      _mins: minsAgo,
    })
  }
  rows.sort((a, b) => a._mins - b._mins) // most recent first by default
  return rows.map(({ _mins, ...r }) => ({ ...r, last_seen: ts(_mins) }))
}

export function makeStubProperties(count = 88): PropertyRow[] {
  const rnd = mulberry32(0x50524f50) // "PROP"
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const usedAddr = new Set<string>()
  const rows: Array<PropertyRow & { _mins: number }> = []
  for (let i = 0; i < count; i++) {
    let addr = ''
    let guard = 0
    do {
      addr = `${1 + Math.floor(rnd() * 240)} ${pick(STREETS)} ${pick(STYPE)}, ${pick(SUBURBS)}`
      guard++
    } while (usedAddr.has(addr) && guard < 8)
    usedAddr.add(addr)
    const sig = weightedSignal(rnd)
    const views = sig === 'watching' ? 2 + Math.floor(rnd() * 40) : 20 + Math.floor(rnd() * 480)
    const visitors = Math.max(1, Math.floor(views * (0.32 + rnd() * 0.4)))
    const minsAgo = Math.floor(Math.pow(rnd(), 1.7) * 20160)
    rows.push({
      id: makeUuid(rnd),
      address: addr,
      views_7d: views,
      visitors,
      top_signal: sig,
      last_viewed: '',
      _mins: minsAgo,
    })
  }
  rows.sort((a, b) => a._mins - b._mins)
  return rows.map(({ _mins, ...r }) => ({ ...r, last_viewed: ts(_mins) }))
}
