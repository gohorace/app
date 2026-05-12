'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Home as HomeIcon, Loader2 } from 'lucide-react'
import {
  AddressAutocomplete,
  type SelectedAddress,
  isAddressEmpty,
} from '@/components/address'

/**
 * HOR-120 — Manual property creation surface.
 *
 * For agents who want to record a property by address before any contact
 * or web-tracking signal exists (typically appraisal targets they want
 * signals on later).
 *
 * The address flows through the same resolve_residence_property pipeline
 * as the contact form — duplicates dedup automatically.
 */
export default function NewPropertyPage() {
  const [residence, setResidence] = useState<SelectedAddress | null>(null)
  const [notes,     setNotes]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<
    { id: string; linkedContacts: number; formatted: string | null } | null
  >(null)

  const canSave = !isAddressEmpty(residence) && !saving

  async function handleSave() {
    if (isAddressEmpty(residence)) {
      setError('Enter an address.')
      return
    }
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residence, notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not save')
        return
      }
      setResult({
        id: data.id,
        linkedContacts: data.linked_contacts ?? 0,
        formatted: residence?.formatted ?? null,
      })
      // Reset form for adding another.
      setResidence(null)
      setNotes('')
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: '640px' }}>
      <Link
        href="/leads"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          color: '#8C7B6B', fontSize: '13px', textDecoration: 'none',
          marginBottom: '16px',
        }}
      >
        <ArrowLeft style={{ width: '14px', height: '14px' }} />
        Back to contacts
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <HomeIcon style={{ width: '20px', height: '20px', color: '#1A1612' }} />
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '24px', fontWeight: 700, color: '#1A1612',
        }}>
          Add a property
        </h1>
      </div>

      <p style={{ fontSize: '13px', color: '#8C7B6B', marginBottom: '24px', lineHeight: 1.5 }}>
        Record an address you want signals on — an appraisal target, a sales
        prospect, anything you&apos;d like to surface alongside contacts on
        the same street. Properties dedup by Google Place ID and address,
        so entering the same address twice won&apos;t create a duplicate.
      </p>

      {result ? (
        <SuccessCard
          formatted={result.formatted}
          linkedContacts={result.linkedContacts}
          onAddAnother={reset}
        />
      ) : (
        <div style={{
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.2)',
          borderRadius: '10px',
          padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '16px',
        }}>
          <AddressAutocomplete
            label="Property address"
            defaultValue={residence}
            onChange={setResidence}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="notes" style={{
              fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#5A4D40',
            }}>
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. appraisal request from John Smith, looking to sell Q3"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                fontFamily: 'var(--font-body)',
                color: '#1A1612',
                background: '#fff',
                border: '1px solid rgba(140,123,107,0.35)',
                borderRadius: '7px',
                outline: 'none',
                resize: 'vertical',
                minHeight: '60px',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: '#8C7B6B', fontStyle: 'italic' }}>
              Notes aren&apos;t stored yet — coming with the property detail
              page in a later slice.
            </p>
          </div>

          {error && (
            <p style={{ fontSize: '12px', color: '#C4622D' }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              style={{
                padding: '10px 20px', borderRadius: '7px',
                background: '#1A1612', border: 'none', color: '#FAF7F2',
                fontSize: '13px', fontWeight: 500,
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                cursor: canSave ? 'pointer' : 'not-allowed',
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {saving && <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />}
              {saving ? 'Saving…' : 'Add property'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface SuccessCardProps {
  formatted: string | null
  linkedContacts: number
  onAddAnother: () => void
}

function SuccessCard({ formatted, linkedContacts, onAddAnother }: SuccessCardProps) {
  return (
    <div style={{
      background: 'rgba(61,82,70,0.06)',
      border: '1px solid rgba(61,82,70,0.2)',
      borderRadius: '10px',
      padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <CheckCircle2 style={{ width: '18px', height: '18px', color: '#3D5246', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p style={{ fontSize: '14px', fontWeight: 600, color: '#1A1612' }}>
            Property added
          </p>
          {formatted && (
            <p style={{ fontSize: '13px', color: '#5A4D40', marginTop: '4px' }}>
              {formatted}
            </p>
          )}
          {linkedContacts > 0 && (
            <p style={{ fontSize: '12px', color: '#A5511E', marginTop: '6px' }}>
              Already linked to {linkedContacts} contact{linkedContacts === 1 ? '' : 's'} —
              this address is on file. Future signals will roll up together.
            </p>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginLeft: '28px' }}>
        <button
          type="button"
          onClick={onAddAnother}
          style={{
            padding: '7px 14px', borderRadius: '6px',
            background: 'transparent', border: '1px solid rgba(140,123,107,0.35)',
            color: '#1A1612', fontSize: '12px', fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Add another
        </button>
        <Link
          href="/leads"
          style={{
            padding: '7px 14px', borderRadius: '6px',
            background: '#1A1612', color: '#FAF7F2',
            fontSize: '12px', fontWeight: 500,
            textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          Back to contacts
        </Link>
      </div>
    </div>
  )
}
