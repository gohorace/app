'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Loader2, X, Eye, Home as HomeIcon, Archive, Edit3 } from 'lucide-react'
import {
  AddressAutocomplete,
  type SelectedAddress,
  isAddressEmpty,
} from '@/components/address'
import { PropertyThumb, STATE_STYLE, toneFor, type PropertyStatus } from '@/lib/design/badges'

type Step = 'input' | 'confirm' | 'state'

interface AddPropertyModalProps {
  onClose: () => void
  /** Called after a property has been persisted. Receives the new property id. */
  onComplete: (propertyId: string) => void
}

/**
 * Three-step add-property flow per AddPropertyModal.jsx:
 *   1. **Input** — address via AddressAutocomplete. We don't show fake
 *      "candidates" because the autocomplete itself surfaces Google's
 *      matches; the design's static candidate list is a mock.
 *   2. **Confirm** — show the picked address + lat/lng / Google place id
 *      so the agent can verify before committing.
 *   3. **State** — pick a relationship (Listed / Off-market / Sold).
 *      Mapped onto the existing `properties.status` enum until the new
 *      vocabulary (Appraising / Watching) lands with a migration.
 *
 * Submit → POST /api/properties (existing route). The address is resolved
 * via `resolve_residence_property` server-side, so re-entering an address
 * already in the workspace dedups to the existing property id.
 */
export function AddPropertyModal({ onClose, onComplete }: AddPropertyModalProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')
  const [residence, setResidence] = useState<SelectedAddress | null>(null)
  const [chosenStatus, setChosenStatus] = useState<PropertyStatus>('watching')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !isAddressEmpty(residence) && !saving

  // V1 relationship-first vocabulary (HOR-135). Four states; the picker
  // surfaces the same icons used elsewhere (Home / Edit / Eye / Archive).
  const stateOptions: Array<{ id: PropertyStatus; Icon: typeof Eye }> = [
    { id: 'listed',     Icon: HomeIcon },
    { id: 'appraising', Icon: Edit3    },
    { id: 'watching',   Icon: Eye      },
    { id: 'sold',       Icon: Archive  },
  ]

  async function handleSave() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    // POST /api/properties calls resolve_residence_property() which now
    // inserts new rows with status='watching' (HOR-135). If the agent
    // picked a different state, PATCH it onto the resulting row.
    const createRes = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residence }),
    })

    const createData = await createRes.json()
    if (!createRes.ok) {
      setError(createData?.error ?? 'Could not save property')
      setSaving(false)
      return
    }

    const propertyId: string = createData.id

    if (chosenStatus !== 'watching') {
      await fetch(`/api/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: chosenStatus }),
      })
    }

    setSaving(false)
    router.refresh()
    onComplete(propertyId)
  }

  // Pre-compute confirm/state card content
  const formattedAddress = residence?.formatted ?? null
  const structured = residence
    ? [residence.street_number, residence.street_name].filter(Boolean).join(' ')
    : ''
  const suburb = residence?.suburb ?? ''
  const tone = toneFor(formattedAddress ?? structured)

  return (
    <div
      role="dialog"
      aria-modal
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={modalStyle}>
        <header style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Add a property</div>
            <div className="font-display" style={titleStyle}>
              {step === 'input'   && 'Type an address. Horace fills in the rest.'}
              {step === 'confirm' && 'Is this the one?'}
              {step === 'state'   && 'What’s your relationship to it?'}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtnStyle}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </header>

        <div style={bodyStyle}>
          {step === 'input' && (
            <>
              <AddressAutocomplete
                label="Property address"
                defaultValue={residence}
                onChange={setResidence}
              />
              <div style={helperBlockStyle}>
                <div>
                  <div style={helperTitleStyle}>The property is shared. Your history with it isn’t.</div>
                  <div style={helperTextStyle}>
                    Horace dedups by Google Place ID and address, so re-entering the
                    same address won’t create a duplicate.
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'confirm' && (
            <div style={confirmCardStyle}>
              <PropertyThumb tone={tone} address={structured || formattedAddress || '·'} size={72} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-display" style={confirmAddressStyle}>
                  {structured || formattedAddress || 'Pending'}
                </div>
                {suburb && (
                  <div style={{ fontSize: 12, color: '#8C7B6B', marginTop: 2 }}>{suburb}</div>
                )}
                {residence?.formatted && residence.formatted !== structured && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#8C7B6B',
                      marginTop: 8,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {residence.formatted}
                  </div>
                )}
                {residence?.google_place_id && (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'rgba(140,123,107,0.6)',
                      marginTop: 6,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    place_id: {residence.google_place_id.slice(0, 16)}…
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'state' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {stateOptions.map((opt) => {
                const isOn = chosenStatus === opt.id
                return (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => setChosenStatus(opt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '14px',
                      background: '#FFFFFF',
                      border: `1.5px solid ${isOn ? '#C4622D' : 'rgba(140,123,107,0.2)'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-body)',
                      transition: 'all 180ms',
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 7,
                        background: isOn ? 'rgba(196,98,45,0.14)' : 'rgba(140,123,107,0.12)',
                        color: isOn ? '#C4622D' : '#5E5246',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <opt.Icon style={{ width: 16, height: 16 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isOn ? '#1A1612' : '#2E2823',
                          marginBottom: 3,
                        }}
                      >
                        {STATE_STYLE[opt.id].label}
                      </div>
                      <div style={{ fontSize: 11, color: '#8C7B6B', lineHeight: 1.4 }}>
                        {STATE_STYLE[opt.id].desc}
                      </div>
                    </div>
                    {isOn && <Check style={{ width: 16, height: 16, color: '#C4622D', flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          )}

          {error && (
            <p
              role="alert"
              style={{
                marginTop: 12,
                padding: '8px 10px',
                background: 'rgba(196,98,45,0.08)',
                border: '1px solid rgba(196,98,45,0.25)',
                borderRadius: 6,
                fontSize: 12,
                color: '#9C4A1F',
              }}
            >
              {error}
            </p>
          )}

          <div style={actionRowStyle}>
            {step === 'input' ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={() => setStep(step === 'state' ? 'confirm' : 'input')}
                disabled={saving}
                style={ghostBtnStyle}
              >
                <ArrowLeft style={{ width: 13, height: 13 }} />
                Back
              </button>
            )}

            {step === 'state' ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  ...primaryBtnStyle,
                  opacity: saving ? 0.6 : 1,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? (
                  <>
                    <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check style={{ width: 13, height: 13 }} />
                    Add to {STATE_STYLE[chosenStatus].label}
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (step === 'input' && !isAddressEmpty(residence)) setStep('confirm')
                  if (step === 'confirm') setStep('state')
                }}
                disabled={step === 'input' && isAddressEmpty(residence)}
                style={{
                  ...primaryBtnStyle,
                  opacity: step === 'input' && isAddressEmpty(residence) ? 0.4 : 1,
                  cursor:
                    step === 'input' && isAddressEmpty(residence)
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {step === 'input' ? "That's the one" : 'Next'}
                <ArrowRight style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        </div>

        <div style={signatureStyle}>Seize the moment — Horace</div>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,22,18,0.55)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 20,
}

const modalStyle: React.CSSProperties = {
  width: 'min(560px, 100%)',
  maxHeight: '90vh',
  background: '#FAF7F2',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(26,22,18,0.32)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '22px 24px 4px',
  gap: 12,
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8C7B6B',
  marginBottom: 6,
}

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 500,
  color: '#1A1612',
  letterSpacing: '-0.01em',
  lineHeight: 1.25,
}

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#8C7B6B',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  alignSelf: 'flex-start',
}

const bodyStyle: React.CSSProperties = {
  padding: '18px 24px 22px',
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const helperBlockStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '14px 16px',
  background: 'rgba(46,40,35,0.04)',
  borderRadius: 8,
}

const helperTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#1A1612',
  marginBottom: 3,
}

const helperTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#5E5246',
  lineHeight: 1.55,
}

const confirmCardStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: 16,
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.18)',
  borderRadius: 10,
  alignItems: 'flex-start',
}

const confirmAddressStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 500,
  color: '#1A1612',
  letterSpacing: '-0.01em',
}

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
}

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 14px',
  borderRadius: 7,
  background: 'transparent',
  color: '#5E5246',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 18px',
  borderRadius: 7,
  background: '#1A1612',
  color: '#F5F0E8',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
}

const signatureStyle: React.CSSProperties = {
  padding: '12px 24px 16px',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(140,123,107,0.45)',
  textAlign: 'right',
}
