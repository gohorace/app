'use client'

import { useState, useRef } from 'react'
import { Upload, FileText, Check, ArrowRight, ArrowLeft } from 'lucide-react'
import styles from './onboarding.module.css'
import contactsStyles from './step-contacts.module.css'

interface Props {
  stepNumber: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
}

interface ImportResult {
  created: number
  matched: number
  skipped: number
  total: number
}

export function StepContacts({ stepNumber, totalSteps, onNext, onBack }: Props) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function pick(f: File) {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please choose a CSV file.')
      return
    }
    setFile(f)
    setError(null)
    setResult(null)
  }

  async function upload() {
    if (!file) return
    setUploading(true); setError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed')
      } else {
        setResult(data)
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={styles.stepFade}>
      <div className={styles.paneMeta}>
        <span>Your contacts</span>
        <span className={styles.paneMetaDivider} />
        <span>Step {stepNumber} of {totalSteps}</span>
      </div>
      <h1 className={styles.paneTitle}>Names you already know.</h1>
      <p className={styles.paneSub}>
        Upload a CSV from your CRM. Horace will match each contact to website activity automatically — so the moment a known name returns, you’ll hear about it.
      </p>

      {result ? (
        <div className={contactsStyles.successCard}>
          <div className={contactsStyles.successIcon}><Check size={24} /></div>
          <div>
            <div className={contactsStyles.successTitle}>{result.total} contacts imported</div>
            <div className={contactsStyles.successMeta}>
              {result.created} new · {result.matched} matched · {result.skipped} skipped
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`${contactsStyles.dropZone} ${dragging ? contactsStyles.dropZoneActive : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) pick(f)
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
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
              ? `${(file.size / 1024).toFixed(1)} KB · ready to import`
              : 'Most CRMs export columns like name, email, phone — Horace figures out the rest.'}
          </div>
        </div>
      )}

      {error && <p className={contactsStyles.error}>{error}</p>}

      {file && !result && (
        <div className={contactsStyles.uploadRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={upload} disabled={uploading} type="button">
            {uploading ? 'Importing…' : 'Import contacts'}
          </button>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setFile(null)} type="button">
            Choose a different file
          </button>
        </div>
      )}

      <div className={styles.paneActions}>
        <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack} type="button">
          <ArrowLeft size={14} /> Back
        </button>
        <div className={styles.paneActionsRight}>
          {!result && (
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onNext} type="button">
              Skip for now
            </button>
          )}
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onNext} type="button">
            {result ? 'Continue' : 'Continue without importing'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
