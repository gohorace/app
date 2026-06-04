'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuditResult, RunResponse } from '@/lib/audit/types'
import { isAuditError } from '@/lib/audit/types'
import { COPY } from './copy'
import { InputState } from './components/InputState'
import { LoadingState } from './components/LoadingState'
import { ReportState } from './components/ReportState'
import styles from './audit.module.css'

type Stage = 'input' | 'loading' | 'report'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Hard ceiling — past this we stop waiting and show the "taking longer" copy.
const AUDIT_TIMEOUT_MS = 92_000

export default function AuditPage() {
  const [stage, setStage] = useState<Stage>('input')
  const [leaving, setLeaving] = useState(false)
  const [domain, setDomain] = useState('')
  const [inputError, setInputError] = useState('')

  const [result, setResult] = useState<AuditResult | null>(null)
  const [auditError, setAuditError] = useState<'unreachable' | 'timeout' | null>(null)
  const [narrationDone, setNarrationDone] = useState(false)

  const reportRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const runAudit = useCallback((d: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), AUDIT_TIMEOUT_MS)

    fetch('/api/site-audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: d }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as RunResponse
        if (isAuditError(data)) {
          setAuditError(data.error === 'invalid' ? 'unreachable' : data.error)
        } else {
          setResult(data)
        }
      })
      .catch((err) => {
        // AbortError → we hit the ceiling; anything else → can't reach our API.
        setAuditError(err?.name === 'AbortError' ? 'timeout' : 'unreachable')
      })
      .finally(() => clearTimeout(timer))
  }, [])

  const handleSubmit = (d: string) => {
    setDomain(d)
    setInputError('')
    setLeaving(true)
    setTimeout(
      () => {
        setLeaving(false)
        setResult(null)
        setAuditError(null)
        setNarrationDone(false)
        setStage('loading')
        runAudit(d)
      },
      prefersReduced() ? 0 : 380,
    )
  }

  const handleNarrationDone = useCallback(() => setNarrationDone(true), [])

  // Drive the loading → report / error transitions.
  useEffect(() => {
    if (stage !== 'loading') return
    if (auditError) {
      // Hard failure — return to the input with the domain still populated and
      // the matching in-voice message. (Both copies stay in voice.)
      abortRef.current?.abort()
      setInputError(
        auditError === 'timeout' ? COPY.input.timeout : COPY.input.unreachable,
      )
      setStage('input')
      setAuditError(null)
      return
    }
    if (narrationDone && result) {
      setStage('report')
    }
  }, [stage, auditError, narrationDone, result])

  // Scroll to the report opener once it mounts.
  useEffect(() => {
    if (stage !== 'report') return
    const id = requestAnimationFrame(() => {
      const el = reportRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      window.scrollTo({ top, behavior: prefersReduced() ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [stage])

  return (
    <div className={styles.audit}>
      {stage === 'report' && (
        <a href="#findings" className={styles.skip}>
          Skip to findings
        </a>
      )}

      {stage === 'input' && (
        <InputState
          onSubmit={handleSubmit}
          leaving={leaving}
          initialValue={domain}
          initialError={inputError}
        />
      )}

      {/* Loading mounts on submit and stays as scroll-up history under the report. */}
      {(stage === 'loading' || stage === 'report') && (
        <LoadingState domain={domain} onNarrationDone={handleNarrationDone} />
      )}

      {stage === 'report' && result && (
        <div ref={reportRef}>
          <ReportState result={result} />
        </div>
      )}
    </div>
  )
}
