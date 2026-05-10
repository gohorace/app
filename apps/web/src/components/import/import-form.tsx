'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, CheckCircle, AlertCircle, FileText, Download, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FieldKey } from '@/lib/crm/csv-parser'
import { FIELD_LABELS } from '@/lib/crm/csv-parser'

interface ImportResult {
  created: number
  matched: number
  skipped: number
  total: number
}

interface PreviewData {
  headers: string[]
  detected: Record<FieldKey, string | null>
  rowCount: number
  sampleRows: Record<string, string>[]
}

const FIELD_ORDER: FieldKey[] = ['email', 'first_name', 'last_name', 'phone', 'crm_external_id']

export function ImportForm() {
  const [dragging, setDragging] = useState(false)
  const [file,     setFile]     = useState<File | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ImportResult | null>(null)
  const [preview,  setPreview]  = useState<PreviewData | null>(null)
  const [mapping,  setMapping]  = useState<Record<FieldKey, string | null>>({
    email: null, first_name: null, last_name: null, phone: null, crm_external_id: null,
  })
  const [error,    setError]    = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }
    setFile(f)
    setError(null)
    setResult(null)
    setPreview(null)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) handleFile(f)
    },
    [handleFile],
  )

  async function handlePreview() {
    if (!file) return
    setLoading(true)
    setError(null)

    const form = new FormData()
    form.append('file', file)

    try {
      const res  = await fetch('/api/import/preview', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not read CSV')
        setLoading(false)
        return
      }
      setPreview({
        headers:    data.headers,
        detected:   data.detected,
        rowCount:   data.rowCount,
        sampleRows: data.sampleRows,
      })
      setMapping(data.detected)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmImport() {
    if (!file) return
    setLoading(true)
    setError(null)

    const form = new FormData()
    form.append('file', file)
    form.append('mapping', JSON.stringify(mapping))

    try {
      const res  = await fetch('/api/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed')
        setLoading(false)
        return
      }
      setResult(data)
      setFile(null)
      setPreview(null)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResult(null)
    setPreview(null)
    setFile(null)
    setError(null)
  }

  // ── Result screen ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
            <div>
              <p className="font-medium">Import complete</p>
              <p className="text-sm text-muted-foreground">{result.total} rows processed</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <Stat label="New contacts" value={result.created} color="text-green-700" />
            <Stat label="Updated"      value={result.matched} color="text-blue-700"  />
            <Stat label="Skipped"      value={result.skipped} color="text-muted-foreground" />
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    )
  }

  // ── Preview / mapping screen ─────────────────────────────────────────────────
  if (preview) {
    const emailMissing = !mapping.email
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { setPreview(null); setError(null) }}
          className="inline-flex items-center gap-1.5 text-sm font-medium"
          style={{ color: '#8C7B6B' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Choose a different file
        </button>

        <div className="rounded-lg border p-4 bg-muted/30">
          <p className="text-sm font-medium">{file?.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {preview.rowCount} row{preview.rowCount !== 1 ? 's' : ''} · {preview.headers.length} column{preview.headers.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Column mapping</p>
          <p className="text-xs text-muted-foreground mb-3">
            We&apos;ve auto-detected your columns. Adjust if anything looks wrong — at minimum,
            email or a name is required to keep a row.
          </p>

          <div className="space-y-2">
            {FIELD_ORDER.map((key) => (
              <div key={key} className="grid grid-cols-[110px_1fr] items-center gap-3">
                <label className="text-xs font-medium" style={{ color: '#5A4D40' }}>
                  {FIELD_LABELS[key]}
                  {key === 'email' && <span style={{ color: '#A5511E' }}> *</span>}
                </label>
                <select
                  value={mapping[key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || null })}
                  className="rounded-md border bg-white px-2 py-1.5 text-sm"
                  style={{ borderColor: 'rgba(140,123,107,0.3)' }}
                >
                  <option value="">— don&apos;t import —</option>
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {emailMissing && (
            <p className="text-xs mt-3" style={{ color: '#A5511E' }}>
              No email column mapped — rows without an email will be matched by external ID
              (or skipped if neither is set).
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium mb-2">
            Preview ({preview.sampleRows.length} of {preview.rowCount} rows)
          </p>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'rgba(140,123,107,0.2)' }}>
            <table className="w-full text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
              <thead style={{ background: '#FAF7F2' }}>
                <tr>
                  {preview.headers.map((h) => {
                    const mappedTo = (Object.keys(mapping) as FieldKey[]).find((k) => mapping[k] === h)
                    return (
                      <th
                        key={h}
                        className="text-left px-2 py-2 border-b"
                        style={{ borderColor: 'rgba(140,123,107,0.15)' }}
                      >
                        <div style={{ color: '#1A1612', fontWeight: 600 }}>{h}</div>
                        {mappedTo && (
                          <div style={{
                            color: '#A5511E', fontWeight: 500,
                            fontSize: '10px', marginTop: '1px',
                          }}>
                            → {FIELD_LABELS[mappedTo]}
                          </div>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h) => (
                      <td
                        key={h}
                        className="px-2 py-1.5 border-b align-top"
                        style={{ borderColor: 'rgba(140,123,107,0.08)', color: '#5A4D40' }}
                      >
                        {row[h] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <Button onClick={handleConfirmImport} disabled={loading} className="w-full">
          {loading ? 'Importing…' : `Import ${preview.rowCount} rows`}
        </Button>
      </div>
    )
  }

  // ── Upload screen ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/30',
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        {file ? (
          <>
            <FileText className="w-10 h-10 mx-auto mb-3 text-primary" />
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(1)} KB — click to change
            </p>
          </>
        ) : (
          <>
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium">Drop your CSV file here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          </>
        )}
      </div>

      <a
        href="/import-template.csv"
        download
        className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        style={{ color: '#A5511E' }}
      >
        <Download className="w-3 h-3" />
        Download template CSV
      </a>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Button onClick={handlePreview} disabled={!file || loading} className="w-full">
        {loading ? 'Reading…' : 'Continue'}
      </Button>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}
