'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  SuburbPicker,
  type SelectedLocality,
} from '@/components/core-markets/suburb-picker'
import type { PatchStatsResponse } from '@/app/api/onboarding/patch-stats/types'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace } from '../copy'
import { markStepComplete } from '../mark-step'
import { makePill, type Action } from '../turn-controller'

interface Props {
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

type Phase = 'choosing' | 'locking' | 'locked'

/** Turn 3 — your patch.
 *
 *  Reuses SuburbPicker verbatim. The agent picks up to 3 suburbs;
 *  when they tap "Lock in" we POST each one to /api/core-markets
 *  (existing route — same as the v1 step-core-markets does), and in
 *  parallel fetch /api/onboarding/patch-stats for placeholder sales /
 *  median values that will render real numbers once a property-data
 *  vendor is selected (open question in CLAUDE.md).
 *
 *  Skip is allowed (per v1) — Horace just notes there's no patch and
 *  advances. The agent can configure markets later via Settings.
 *
 *  Free-text recovery for typed-but-not-found suburbs is HOR-213; the
 *  typeahead is the only resolution path here for now. */
export function Turn3Patch({ dispatch, onAdvance }: Props) {
  const didMount = useRef(false)
  const [selected, setSelected] = useState<SelectedLocality[]>([])
  const [phase, setPhase] = useState<Phase>('choosing')
  const [error, setError] = useState<string | null>(null)

  // Opening Horace line on mount.
  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t3_ask_patch() })
  }, [dispatch])

  const canSubmit = selected.length >= 1 && phase === 'choosing'

  const lockIn = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setPhase('locking')

    // Echo the agent's choices as a user bubble.
    const userText = selected
      .map((s) => s.locality_name)
      .join(', ')
    dispatch({ type: 'user_says', text: userText })

    // Spawn one work pill per locality so Horace's progress reads as
    // "Adding Paddington…" / "Adding Bulimba…" — each resolves in
    // place to a stat label.
    const pills = selected.map((s) =>
      makePill('work', `Adding ${s.locality_name}`),
    )
    dispatch({ type: 'horace_says', text: '', pills })

    const pillByPid = new Map<string, string>()
    selected.forEach((s, i) => pillByPid.set(s.locality_pid, pills[i].id))

    // POST each market sequentially (same pattern as v1
    // step-core-markets.tsx — three POSTs max, stop on first failure
    // so the agent sees a clean inline error without reasoning about
    // partial success).
    for (const s of selected) {
      try {
        const res = await fetch('/api/core-markets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locality_pid: s.locality_pid }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          dispatch({
            type: 'pill_update',
            id: pillByPid.get(s.locality_pid)!,
            patch: {
              kind: 'err',
              label: `Couldn't add ${s.locality_name}`,
            },
          })
          setError(body.error ?? `Couldn't add ${s.locality_name}. Try again?`)
          setPhase('choosing')
          return
        }
      } catch {
        dispatch({
          type: 'pill_update',
          id: pillByPid.get(s.locality_pid)!,
          patch: {
            kind: 'err',
            label: `Couldn't add ${s.locality_name}`,
          },
        })
        setError(`Network blip — try again?`)
        setPhase('choosing')
        return
      }
    }

    // Fetch patch stats in one shot. Stub returns null sales/median
    // for now; HOR-214 polish swaps the body when the vendor lands.
    let statsByPid = new Map<string, { sales_90d: number | null; median_price: number | null }>()
    try {
      const params = new URLSearchParams()
      selected.forEach((s) => params.append('pid', s.locality_pid))
      const res = await fetch(`/api/onboarding/patch-stats?${params.toString()}`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const json = (await res.json()) as PatchStatsResponse
        statsByPid = new Map(
          json.stats.map((r) => [
            r.pid,
            { sales_90d: r.sales_90d, median_price: r.median_price },
          ]),
        )
      }
    } catch {
      // Soft failure — pills just render the suburb name + an em dash.
    }

    // Resolve each pill to its final label.
    for (const s of selected) {
      const stat = statsByPid.get(s.locality_pid)
      const label = composeStatLabel(s.locality_name, stat)
      dispatch({
        type: 'pill_update',
        id: pillByPid.get(s.locality_pid)!,
        patch: { kind: 'ok', label },
      })
    }

    // Horace's two follow-up lines.
    const names = selected.map((s) => s.locality_name)
    dispatch({ type: 'horace_says', text: horace.t3_locked_in(names) })
    dispatch({ type: 'horace_says', text: horace.t3_patch_aside() })

    await markStepComplete('core_markets')
    setPhase('locked')
    onAdvance()
  }, [canSubmit, dispatch, onAdvance, selected])

  const skip = useCallback(async () => {
    setError(null)
    setPhase('locking')
    dispatch({ type: 'user_says', text: 'Skip for now' })
    await markStepComplete('core_markets')
    setPhase('locked')
    onAdvance()
  }, [dispatch, onAdvance])

  if (phase === 'locked') {
    // Once locked the turn is done — the shell will key-mount Turn 4 in
    // its place. Render nothing during the brief frame before advance.
    return null
  }

  return (
    <div className={styles.patchInputWrap}>
      <SuburbPicker
        selected={selected}
        onChange={setSelected}
        min={1}
        max={3}
        autoFocus
        placeholder="Type a suburb…"
      />

      {error ? <p className={styles.patchError}>{error}</p> : null}

      <div className={styles.turnActions} style={{ marginTop: 16 }}>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
          onClick={lockIn}
          disabled={!canSubmit}
        >
          {phase === 'locking'
            ? 'Locking in…'
            : selected.length > 1
              ? 'Lock these in'
              : 'Lock it in'}
          {phase !== 'locking' && <ArrowRight size={14} />}
        </button>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnGhost}`}
          onClick={skip}
          disabled={phase === 'locking'}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}

/** Render the pill label for a confirmed locality:
 *    "Paddington · 47 sales · median $1.2m"  (when stats present)
 *    "Paddington"                            (when sales/median null)
 *
 *  The dash-separated shape matches Turn 2's "47 live listings ·
 *  WordPress detected" reading so the chip vocabulary stays uniform.
 *  When the property-data vendor lands, the pills upgrade with no
 *  code change here — the stats fetcher just stops returning nulls. */
function composeStatLabel(
  name: string,
  stat: { sales_90d: number | null; median_price: number | null } | undefined,
): string {
  if (!stat || (stat.sales_90d == null && stat.median_price == null)) {
    return name
  }
  const parts: string[] = [name]
  if (stat.sales_90d != null) parts.push(`${stat.sales_90d} sales`)
  if (stat.median_price != null) {
    parts.push(`median ${formatMedian(stat.median_price)}`)
  }
  return parts.join(' · ')
}

function formatMedian(price: number): string {
  // Compact $1.2m / $850k / $620k for the chip. Whole-dollar inputs.
  if (price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(price >= 10_000_000 ? 0 : 1)}m`
  }
  if (price >= 1_000) {
    return `$${Math.round(price / 1_000)}k`
  }
  return `$${price}`
}
