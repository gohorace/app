'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, Link2, Calendar, ArrowRight } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { HelpModal, type HelpKind } from '../../help-modal'
import scriptStyles from '../../step-script.module.css'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace } from '../copy'
import { markStepComplete } from '../mark-step'
import { suggestedUrlFromEmail } from '@/lib/onboarding/email-domain'
import { trackingSnippet } from '@/lib/onboarding/snippet'
import { makePill, type Action } from '../turn-controller'
import type { SiteProbeResponse } from '@/app/api/onboarding/site-probe/route'

interface Props {
  email: string
  snippetKey: string
  appUrl: string
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

type Phase = 'asking' | 'probing' | 'snippet' | 'done'

/** Turn 2 — tracking script.
 *
 *  Flow: Horace suggests the site (pre-filled from email domain when
 *  it's not a generic inbox provider), agent confirms or edits, probe
 *  runs (stubbed in PR 3 — PR 4 wires the real fetcher + bail rule),
 *  snippet renders, agent pastes / sends to web person / books a call,
 *  verify-snippet polling either confirms the install or the agent
 *  taps "I've pasted it" to advance manually.
 *
 *  v1's StepScript polls verify-snippet at 3s for 5min — we mirror that
 *  pattern verbatim so behaviour is identical across surfaces. */
export function Turn2Script({
  email,
  snippetKey,
  appUrl,
  dispatch,
  onAdvance,
}: Props) {
  const didMount = useRef(false)
  const [phase, setPhase] = useState<Phase>('asking')
  const [url, setUrl] = useState(() => suggestedUrlFromEmail(email))
  const [helpOpen, setHelpOpen] = useState<HelpKind | null>(null)
  const [probePillId, setProbePillId] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAtRef = useRef<number>(0)

  // Dispatch the opening Horace line on mount. If we have a sensible
  // domain suggestion ("Looks like you're at X"), use it; otherwise
  // fall back to "What's the URL?".
  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    const suggested = suggestedUrlFromEmail(email)
    const host = suggested ? new URL(suggested).hostname : null
    dispatch({
      type: 'horace_says',
      text: host ? horace.t2_suggest_site(host) : horace.t2_ask_site(),
    })
  }, [dispatch, email])

  // Snippet polling — mirrors v1 step-script.tsx behaviour exactly.
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    stopAtRef.current = Date.now() + 5 * 60 * 1000
    pollRef.current = setInterval(async () => {
      if (Date.now() > stopAtRef.current) {
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }
      try {
        const res = await fetch('/api/onboarding/verify-snippet', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as { verified: boolean }
        if (data.verified) {
          setVerified(true)
          dispatch({ type: 'horace_says', text: horace.t2_tracking_confirmed() })
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // network blip — keep polling
      }
    }, 3000)
  }, [dispatch])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function handleConfirm() {
    const trimmed = url.trim()
    if (!trimmed) return

    // User bubble — what they confirmed.
    dispatch({ type: 'user_says', text: trimmed })
    setPhase('probing')

    // Spawn the work pill. The probe (stubbed in PR 3) resolves the
    // pill to ok/err and dispatches the Horace follow-up.
    const pill = makePill('work', 'Reading your site')
    setProbePillId(pill.id)
    dispatch({
      type: 'horace_says',
      text: '', // placeholder bubble that owns the pills
      pills: [pill],
    })

    try {
      const res = await fetch('/api/onboarding/site-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = (await res.json()) as SiteProbeResponse

      if (data.ok) {
        // PR 3 stub returns listings=0, cms='unknown' — the pill label
        // stays generic until PR 4 swaps in real values. The contract is
        // already in place; nothing here changes when real data lands.
        const label =
          data.listings > 0
            ? `${data.listings} live listings`
            : 'Site found'
        dispatch({
          type: 'pill_update',
          id: pill.id,
          patch: { kind: 'ok', label },
        })
        dispatch({ type: 'horace_says', text: horace.t2_found_site() })
        dispatch({ type: 'horace_says', text: horace.t2_snippet_intro() })
        setPhase('snippet')
        startPolling()
      } else {
        // PR 4 handles the two-fails-bail count. PR 3 just marks the
        // pill as an error and keeps the agent on this turn — they can
        // re-edit the URL and retry, or use the persistent escape hatch.
        dispatch({
          type: 'pill_update',
          id: pill.id,
          patch: { kind: 'err', label: probeReasonLabel(data.reason) },
        })
        setPhase('asking')
      }
    } catch {
      dispatch({
        type: 'pill_update',
        id: pill.id,
        patch: { kind: 'err', label: "Couldn't reach your site" },
      })
      setPhase('asking')
    }
  }

  async function handlePasted() {
    setPhase('done')
    await markStepComplete('script')
    onAdvance()
  }

  const snippet = trackingSnippet(snippetKey, appUrl)
  // probePillId is read by future PRs when we want to attach more pills
  // to the same Horace line; intentionally referenced to keep eslint quiet.
  void probePillId

  return (
    <>
      {/* URL input — only visible until the probe succeeds. */}
      {(phase === 'asking' || phase === 'probing') && (
        <div className={scriptStyles.field}>
          <label className={scriptStyles.fieldLabel} htmlFor="onb-agentic-website">
            Your website
          </label>
          <input
            id="onb-agentic-website"
            className={scriptStyles.fieldInput}
            placeholder="reidproperty.com.au"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="url"
            disabled={phase === 'probing'}
          />
          <div className={styles.turnActions} style={{ marginTop: 12 }}>
            <button
              type="button"
              className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
              onClick={handleConfirm}
              disabled={phase === 'probing' || !url.trim()}
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Snippet block + help paths — appear once the probe succeeds. */}
      {phase === 'snippet' && (
        <>
          <div className={scriptStyles.snippetBlock}>
            <div className={scriptStyles.snippetHeader}>
              <span className={scriptStyles.snippetLabel}>
                Paste before <code>&lt;/head&gt;</code>
              </span>
              <CopyButton text={snippet} />
            </div>
            <pre className={scriptStyles.snippetCode}>
              <code>{snippet}</code>
            </pre>
            <div className={scriptStyles.verifyRow}>
              {verified ? (
                <span className={`${scriptStyles.pill} ${scriptStyles.pillDetected}`}>
                  Snippet live
                </span>
              ) : (
                <span className={`${scriptStyles.pill} ${scriptStyles.pillDetecting}`}>
                  <span className={scriptStyles.pulseDot} aria-hidden /> Listening
                  for your first ping…
                </span>
              )}
            </div>
          </div>

          <div className={scriptStyles.helpRow}>
            <span className={scriptStyles.helpLabel}>{horace.t2_help_offer()}</span>
            <div className={scriptStyles.helpButtons}>
              <button
                className={scriptStyles.helpBtn}
                onClick={() => setHelpOpen('email')}
                type="button"
              >
                <Mail size={14} /> Send to your web person
              </button>
              <button
                className={scriptStyles.helpBtn}
                onClick={() => setHelpOpen('share')}
                type="button"
              >
                <Link2 size={14} /> Share install link
              </button>
              <button
                className={scriptStyles.helpBtn}
                onClick={() => setHelpOpen('book')}
                type="button"
              >
                <Calendar size={14} /> Book a 15-min call
              </button>
            </div>
          </div>

          <div className={styles.turnActions} style={{ marginTop: 20 }}>
            <button
              type="button"
              className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
              onClick={handlePasted}
            >
              {verified ? 'Continue' : "I've pasted it"} <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}

      <HelpModal
        kind={helpOpen}
        snippet={snippet}
        snippetKey={snippetKey}
        appUrl={appUrl}
        onClose={() => setHelpOpen(null)}
      />
    </>
  )
}

function probeReasonLabel(reason: 'unreachable' | 'blocked' | 'parse' | 'timeout'): string {
  switch (reason) {
    case 'timeout':
      return 'Your site took too long to answer'
    case 'blocked':
      return "Your site's blocking me"
    case 'parse':
      return "Couldn't read that URL"
    case 'unreachable':
    default:
      return "Couldn't reach your site"
  }
}
