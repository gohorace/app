'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Home, KeyRound, CircleDashed, Loader2, Mail, Phone, Shield, X } from 'lucide-react'
import { PropertyThumb, RoleBadge, toneFor, type ContactRole } from '@/lib/design/badges'
import { makeInitials } from '@/lib/contacts/identity'

interface PropertyOption {
  id: string
  street_number: string | null
  street_name: string | null
  suburb: string | null
}

type Step = 'input' | 'role' | 'confirm'
type RoleChoice = 'seller' | 'buyer' | 'none'

interface AddContactDialogProps {
  onClose: () => void
  /** Called after a contact (and optional role) has been persisted. */
  onComplete: (contactId: string) => void
}

/**
 * Three-step add-contact flow per the design (AddContactModal.jsx):
 *   1. **Input** — name + email + phone. At least name (≥ 2 chars) + one
 *      contact channel (email OR phone) required.
 *   2. **Role** — optional. Seller / Buyer / Skip. If a role is chosen,
 *      pick a property from the workspace's existing properties (loaded
 *      from GET /api/properties).
 *   3. **Confirm** — avatar + name + email/phone + optional role pill,
 *      then submit.
 *
 * Submit path:
 *   - POST /api/contacts to create the contact (no residence in V1).
 *   - If a role was chosen, immediately PATCH the new contact with
 *     `{ add_role: { type, property_id } }`.
 */
export function AddContactDialog({ onClose, onComplete }: AddContactDialogProps) {
  const [step, setStep] = useState<Step>('input')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('none')
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [propsLoading, setPropsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2 lazy-load: only fetch properties when the user reaches the
  // role step (most contacts won't bother with a role). One small request.
  useEffect(() => {
    if (step !== 'role' || properties.length > 0) return
    setPropsLoading(true)
    fetch('/api/properties')
      .then((r) => r.json())
      .then((data: { properties?: PropertyOption[] }) => {
        setProperties(data.properties ?? [])
      })
      .catch(() => setProperties([]))
      .finally(() => setPropsLoading(false))
  }, [step, properties.length])

  const firstName = name.trim().split(/\s+/)[0] ?? ''
  const lastName  = name.trim().split(/\s+/).slice(1).join(' ')
  const canProceedFromInput = name.trim().length >= 2 && (email.trim() || phone.trim())
  const canProceedFromRole = roleChoice === 'none' || propertyId !== null

  async function handleSubmit() {
    if (saving) return
    setSaving(true)
    setError(null)

    // 1. Create the contact.
    const createRes = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName || null,
        last_name:  lastName  || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        residence: null, // address handled separately on detail page
      }),
    })

    const createData = await createRes.json()
    if (!createRes.ok) {
      setError(createData?.error ?? 'Could not create contact')
      setSaving(false)
      return
    }
    const contactId: string = createData.id

    // 2. Attach role if one was chosen.
    if (roleChoice !== 'none' && propertyId) {
      const roleRes = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          add_role: { type: roleChoice, property_id: propertyId },
        }),
      })
      if (!roleRes.ok) {
        const errData = await roleRes.json()
        setError(`Contact created but role failed: ${errData?.error ?? 'unknown error'}`)
        // Still surface success — the contact exists, role can be added on detail page.
      }
    }

    setSaving(false)
    onComplete(contactId)
  }

  return (
    <div
      role="dialog"
      aria-modal
      style={{
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
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '90vh',
          background: '#FAF7F2',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(26,22,18,0.32)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 24px 4px', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#8C7B6B',
                marginBottom: 6,
              }}
            >
              Add a contact
            </div>
            <div
              className="font-display"
              style={{
                fontSize: 22,
                fontWeight: 500,
                color: '#1A1612',
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
              }}
            >
              {step === 'input'   && 'Light details. Horace handles the rest.'}
              {step === 'role'    && 'Attach a property role?'}
              {step === 'confirm' && 'Looks good?'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#8C7B6B',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </header>

        <div style={{ padding: '18px 24px 18px', flex: 1, overflowY: 'auto' }}>
          {step === 'input' && (
            <InputStep
              name={name}
              email={email}
              phone={phone}
              onNameChange={setName}
              onEmailChange={setEmail}
              onPhoneChange={setPhone}
            />
          )}
          {step === 'role' && (
            <RoleStep
              roleChoice={roleChoice}
              onRoleChange={setRoleChoice}
              propertyId={propertyId}
              onPropertyChange={setPropertyId}
              properties={properties}
              loading={propsLoading}
            />
          )}
          {step === 'confirm' && (
            <ConfirmStep
              firstName={firstName}
              lastName={lastName}
              email={email}
              phone={phone}
              roleChoice={roleChoice}
              propertyId={propertyId}
              properties={properties}
            />
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

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              marginTop: 18,
            }}
          >
            {step === 'input' ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={() => setStep(step === 'confirm' ? 'role' : 'input')}
                disabled={saving}
                style={ghostStyle}
              >
                <ArrowLeft style={{ width: 13, height: 13 }} />
                Back
              </button>
            )}

            {step === 'confirm' ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                style={{
                  ...primaryStyle,
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
                    Add to Contacts
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (step === 'input'  && canProceedFromInput) setStep('role')
                  if (step === 'role'   && canProceedFromRole)  setStep('confirm')
                }}
                disabled={step === 'input' ? !canProceedFromInput : !canProceedFromRole}
                style={{
                  ...primaryStyle,
                  opacity: (step === 'input' ? canProceedFromInput : canProceedFromRole) ? 1 : 0.4,
                  cursor: (step === 'input' ? canProceedFromInput : canProceedFromRole) ? 'pointer' : 'not-allowed',
                }}
              >
                Next
                <ArrowRight style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '10px 24px 16px',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(140,123,107,0.45)',
            textAlign: 'right',
          }}
        >
          Seize the moment — Horace
        </div>
      </div>
    </div>
  )
}

// ── Steps ────────────────────────────────────────────────────────────────────

function InputStep({
  name,
  email,
  phone,
  onNameChange,
  onEmailChange,
  onPhoneChange,
}: {
  name: string
  email: string
  phone: string
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onPhoneChange: (v: string) => void
}) {
  return (
    <div>
      <FieldLabel>Name</FieldLabel>
      <Input value={name} onChange={onNameChange} placeholder="Sarah Thompson" autoFocus />

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Email</FieldLabel>
          <Input value={email} onChange={onEmailChange} placeholder="sarah@example.com" type="email" />
        </div>
        <div style={{ flex: 1 }}>
          <FieldLabel>Phone</FieldLabel>
          <Input value={phone} onChange={onPhoneChange} placeholder="04xx xxx xxx" type="tel" />
        </div>
      </div>

      <p
        style={{
          fontSize: 12,
          color: '#8C7B6B',
          marginTop: 12,
          marginBottom: 16,
        }}
      >
        One of email or phone is enough — Horace figures out the rest from your site.
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '14px 16px',
          background: 'rgba(46,40,35,0.04)',
          borderRadius: 8,
        }}
      >
        <Shield style={{ width: 13, height: 13, color: '#8C7B6B', marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1612', marginBottom: 3 }}>
            The behaviour belongs to you.
          </div>
          <div style={{ fontSize: 12, color: '#5E5246', lineHeight: 1.55 }}>
            Their record is yours, sovereign across every tool you ever use. Bring or take it
            whenever you want.
          </div>
        </div>
      </div>
    </div>
  )
}

function RoleStep({
  roleChoice,
  onRoleChange,
  propertyId,
  onPropertyChange,
  properties,
  loading,
}: {
  roleChoice: RoleChoice
  onRoleChange: (v: RoleChoice) => void
  propertyId: string | null
  onPropertyChange: (id: string | null) => void
  properties: PropertyOption[]
  loading: boolean
}) {
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <RoleCard
          label="Vendor"
          desc="You represented them on a sale"
          Icon={Home}
          active={roleChoice === 'seller'}
          onClick={() => onRoleChange('seller')}
        />
        <RoleCard
          label="Buyer"
          desc="You represented them on a buy"
          Icon={KeyRound}
          active={roleChoice === 'buyer'}
          onClick={() => onRoleChange('buyer')}
        />
        <RoleCard
          label="Skip"
          desc="No role yet — attach later"
          Icon={CircleDashed}
          active={roleChoice === 'none'}
          onClick={() => {
            onRoleChange('none')
            onPropertyChange(null)
          }}
        />
      </div>

      {roleChoice !== 'none' && (
        <>
          <FieldLabel>Which property?</FieldLabel>
          {loading ? (
            <div style={{ padding: '20px 8px', display: 'flex', alignItems: 'center', gap: 8, color: '#8C7B6B', fontSize: 12 }}>
              <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              Loading your properties…
            </div>
          ) : properties.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                fontSize: 12,
                color: '#5E5246',
                background: 'rgba(140,123,107,0.06)',
                border: '1px dashed rgba(140,123,107,0.25)',
                borderRadius: 8,
                lineHeight: 1.55,
              }}
            >
              No properties in your workspace yet. You can add this contact without a role
              now — once you&rsquo;ve added a property, attach the role from the contact&rsquo;s
              detail page.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4 }}>
              {properties.map((p) => {
                const address = [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || 'Address pending'
                const selected = p.id === propertyId
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => onPropertyChange(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '8px 12px',
                      background: '#FFFFFF',
                      border: `1.5px solid ${selected ? '#C4622D' : 'rgba(140,123,107,0.18)'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-body)',
                      transition: 'all 180ms',
                    }}
                  >
                    <PropertyThumb tone={toneFor(p.id)} address={address} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1612' }}>{address}</div>
                      {p.suburb && (
                        <div style={{ fontSize: 11, color: '#8C7B6B', marginTop: 2 }}>{p.suburb}</div>
                      )}
                    </div>
                    {selected && <Check style={{ width: 15, height: 15, color: '#C4622D', flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ConfirmStep({
  firstName,
  lastName,
  email,
  phone,
  roleChoice,
  propertyId,
  properties,
}: {
  firstName: string
  lastName: string
  email: string
  phone: string
  roleChoice: RoleChoice
  propertyId: string | null
  properties: PropertyOption[]
}) {
  const initials = makeInitials({ first_name: firstName, last_name: lastName, email })
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || email || 'Unnamed contact'
  const selectedProperty = propertyId
    ? properties.find((p) => p.id === propertyId) ?? null
    : null
  const propertyAddress = selectedProperty
    ? [selectedProperty.street_number, selectedProperty.street_name].filter(Boolean).join(' ') ||
      selectedProperty.suburb ||
      'Address pending'
    : null

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: 16,
          background: '#FFFFFF',
          border: '1px solid rgba(140,123,107,0.18)',
          borderRadius: 10,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(196,98,45,0.14)',
            color: '#C4622D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 600,
            flexShrink: 0,
          }}
          aria-hidden
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-display"
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: '#1A1612',
              letterSpacing: '-0.01em',
            }}
          >
            {fullName}
          </div>
          <div style={{ fontSize: 12, color: '#5E5246', marginTop: 4 }}>
            {email && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Mail style={{ width: 11, height: 11 }} /> {email}
              </span>
            )}
            {email && phone && (
              <span style={{ color: 'rgba(140,123,107,0.4)', margin: '0 8px' }}>·</span>
            )}
            {phone && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Phone style={{ width: 11, height: 11 }} /> {phone}
              </span>
            )}
          </div>
          {roleChoice !== 'none' && propertyAddress && (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <RoleBadge role={roleChoice as ContactRole} />
              <span style={{ fontSize: 12, color: '#5E5246' }}>of</span>
              <span style={{ fontSize: 12, color: '#1A1612', fontWeight: 500 }}>
                {propertyAddress}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Primitives ───────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 500,
        color: '#5E5246',
        marginBottom: 6,
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </label>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        width: '100%',
        padding: '10px 12px',
        fontSize: 14,
        fontFamily: 'var(--font-body)',
        color: '#1A1612',
        background: '#FFFFFF',
        border: '1.5px solid rgba(140,123,107,0.3)',
        borderRadius: 8,
        outline: 'none',
      }}
    />
  )
}

function RoleCard({
  label,
  desc,
  Icon,
  active,
  onClick,
}: {
  label: string
  desc: string
  Icon: typeof Home
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px',
        background: '#FFFFFF',
        border: `1.5px solid ${active ? '#C4622D' : 'rgba(140,123,107,0.2)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-body)',
        transition: 'all 180ms',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: active ? 'rgba(196,98,45,0.14)' : 'rgba(140,123,107,0.12)',
          color: active ? '#C4622D' : '#5E5246',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon style={{ width: 15, height: 15 }} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#1A1612' : '#2E2823' }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: '#8C7B6B', lineHeight: 1.4, marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  )
}

const ghostStyle: React.CSSProperties = {
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

const primaryStyle: React.CSSProperties = {
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
