/**
 * Texture line for the "Something's stirring" notification email.
 *
 * The notification email's only job is to get the agent to open their Stream —
 * it is the tap on the shoulder, not the briefing. It must never list named
 * contacts, counts, or individual signals. The email is a snapshot at send time
 * and the Stream is live state, so the two diverge by design; describing the
 * *shape* of what's stirring (categories, not entities) is what keeps the email
 * true no matter how the Stream moves afterward.
 *
 * The line is keyed to the actual mix at send time — never a hardcoded string —
 * and must never describe a signal that isn't there.
 *
 * See the handoff for the canonical variant table.
 */

export interface TextureBuckets {
  /** Entities Horace has a resolved name for (returning/known contacts). */
  familiar: number
  /** Entities with activity but no name yet (the early, pre-form signal). */
  anonymous: number
}

/**
 * Single fallback used when bucketing is uncertain at send time. Carries no
 * texture, so it can never overstate. When this is rendered, the caller drops
 * the following fixed sentence ("Horace thinks they're worth a look.") because
 * the fallback already names Horace.
 */
export const TEXTURE_FALLBACK = 'Horace caught a few things worth your attention.'

/**
 * Picks the texture line from the variant table based on which buckets are
 * non-empty. "A couple of" stands in for any familiar plural (>= 2) and "a few"
 * for any anonymous plural — we deliberately never generate exact counts, since
 * counts are what invite the reconciliation problem we're avoiding.
 *
 * Returns {@link TEXTURE_FALLBACK} when nothing is stirring or the mix can't be
 * classified — callers should treat a fallback return as "render the line on its
 * own, without the trailing fixed sentence".
 */
export function selectTextureLine({ familiar, anonymous }: TextureBuckets): string {
  const f = Math.max(0, Math.floor(familiar))
  const a = Math.max(0, Math.floor(anonymous))

  if (f === 0 && a === 0) return TEXTURE_FALLBACK

  if (a === 0) {
    return f === 1
      ? 'A familiar face is back.'
      : 'A couple of familiar faces are back.'
  }

  if (f === 0) {
    return a === 1
      ? 'Someone new is circling.'
      : 'A few new faces are circling.'
  }

  // Both buckets non-empty — the anonymous side always reads as "someone new",
  // singular or plural (the table never pluralises the suffix).
  return f === 1
    ? 'A familiar face, and someone new.'
    : 'A couple of familiar faces, and someone new.'
}

/** True when the selected line is the no-texture fallback. */
export function isTextureFallback(line: string): boolean {
  return line === TEXTURE_FALLBACK
}
