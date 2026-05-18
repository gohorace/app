'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, ArrowRight } from 'lucide-react'
import contactsStyles from '../../step-contacts.module.css'
import wizardStyles from '../../onboarding.module.css'
import styles from '../agentic-shell.module.css'
import { horace } from '../copy'
import { markStepComplete } from '../mark-step'
import { makePill, type Action } from '../turn-controller'
import type { ContactsInPatchResponse } from '@/app/api/onboarding/contacts-in-patch/types'

interface Props {
  dispatch: React.Dispatch<Action>
  onAdvance: () => void
}

interface ImportResult {
  created: number
  matched: number
  skipped: number
  total: number
}

type Phase = 'asking' | 'importing' | 'reporting' | 'done'

/** Turn 4 — your contacts.
 *
 *  Agent drops a CSV. We POST to the existing /api/import (same route
 *  v1 step-contacts uses), then fetch /api/onboarding/contacts-in-patch
 *  to surface "X of N already live in your patch". The brief's bail
 *  rule for this turn is one-strike: if /api/import returns 4xx, we
 *  fire show_bail immediately — the brief reads "CSV parse fails or
 *  columns unreadable → bail to classic Step 4".
 *
 *  Skip is allowed (no contacts written) and advances Horace to a
 *  shorter ack line. */
export function Turn4Contacts({ dispatch, onAdvance }: Props) {
  const didMount = useRef(false)
  const [phase, setPhase] = useState<Phase>('asking')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (didMount.current) return
    didMount.current = true
    dispatch({ type: 'horace_says', text: horace.t4_ask_contacts() })
  }, [dispatch])

  function pick(f: File) {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please choose a CSV file.')
      return
    }
    setFile(f)
    setError(null)
  }

  async function importCsv() {
    if (!file) return
    setError(null)
    setPhase('importing')

    // User bubble — what they're handing over.
    dispatch({ type: 'user_says', text: file.name })

    // Work pill: "Reading {filename}…"
    const readPill = makePill('work', `Reading ${file.name}`)
    dispatch({ type: 'horace_says', text: '', pills: [readPill] })

    const form = new FormData()
    form.append('file', file)

    let result: ImportResult | null = null
    try {
      const res = await fetch('/api/import', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))

      if (!res.ok) {
        // One-strike bail per the brief.
        dispatch({
          type: 'pill_update',
          id: readPill.id,
          patch: { kind: 'err', label: "Couldn't read that file" },
        })
        dispatch({ type: 'horace_says', text: horace.t4_csv_parse_fail() })
        dispatch({ type: 'show_bail' })
        setError((data as { error?: string }).error ?? 'Import failed')
        setPhase('asking')
        return
      }
      result = data as ImportResult
    } catch {
      dispatch({
        type: 'pill_update',
        id: readPill.id,
        patch: { kind: 'err', label: 'Network blip — try again?' },
      })
      setError('Network error — please try again.')
      setPhase('asking')
      return
    }

    // Import succeeded — resolve the read pill.
    dispatch({
      type: 'pill_update',
      id: readPill.id,
      patch: {
        kind: 'ok',
        label: `${result.total} parsed · ${result.skipped} folded`,
      },
    })

    // Second pill, second fetch — "matching against your patch".
    const matchPill = makePill('work', 'Matching against your patch')
    dispatch({ type: 'horace_says', text: '', pills: [matchPill] })

    let inPatch = 0
    let totalRows = result.total
    try {
      const r = await fetch('/api/onboarding/contacts-in-patch', {
        cache: 'no-store',
      })
      if (r.ok) {
        const data = (await r.json()) as ContactsInPatchResponse
        inPatch = data.in_patch
        // Prefer the server's total — it reflects post-dedupe state and
        // any pre-existing contacts on the workspace.
        totalRows = data.total
      }
    } catch {
      // Soft failure — fall back to the import result count and skip
      // the patch-match copy.
    }

    dispatch({
      type: 'pill_update',
      id: matchPill.id,
      patch: {
        kind: 'ok',
        label:
          inPatch > 0
            ? `${inPatch} in your patch`
            : 'No patch matches yet',
      },
    })

    const line = horace.t4_in_patch(inPatch, totalRows)
    if (line) dispatch({ type: 'horace_says', text: line })

    await markStepComplete('contacts')
    setPhase('done')
    onAdvance()
  }

  async function skip() {
    setError(null)
    setPhase('importing')
    dispatch({ type: 'user_says', text: 'Skip for now' })
    dispatch({ type: 'horace_says', text: horace.t4_skip_ack() })
    await markStepComplete('contacts')
    setPhase('done')
    onAdvance()
  }

  if (phase === 'done') return null

  return (
    <div className={styles.patchInputWrap}>
      <div
        className={`${contactsStyles.dropZone} ${dragging ? contactsStyles.dropZoneActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) pick(f)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className={contactsStyles.hiddenInput}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pick(f)
          }}
        />
        <div className={contactsStyles.dropIcon}>
          {file ? <FileText size={28} /> : <Upload size={28} />}
        </div>
        <div className={contactsStyles.dropTitle}>
          {file ? file.name : 'Drop a CSV, or click to choose'}
        </div>
        <div className={contactsStyles.dropSub}>
          {file
            ? `${(file.size / 1024).toFixed(1)} KB · ready when you are`
            : "Most CRMs export columns like name, email, phone — I'll figure out the rest."}
        </div>
      </div>

      {error ? <p className={styles.patchError}>{error}</p> : null}

      <div className={styles.turnActions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnPrimary}`}
          onClick={importCsv}
          disabled={!file || phase === 'importing'}
        >
          {phase === 'importing' ? 'Reading…' : 'Hand it over'}
          {phase !== 'importing' && <ArrowRight size={14} />}
        </button>
        <button
          type="button"
          className={`${wizardStyles.btn} ${wizardStyles.btnGhost}`}
          onClick={skip}
          disabled={phase === 'importing'}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
