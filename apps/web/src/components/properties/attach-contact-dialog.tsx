'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Home, KeyRound, Loader2, Search, X } from 'lucide-react'
import { PersonAvatar } from '@/lib/design/badges'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'

type RoleChoice = 'seller' | 'buyer'

interface ContactOption {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  score: number
  last_seen_at: string | null
}

interface AttachContactDialogProps {
  propertyId: string
  propertyAddress: string
  onClose: () => void
}

/**
 * HOR-137 — inverted counterpart of AttachRoleDialog. Used from the
 * Property Detail page: pick a contact, set their role (Seller / Buyer)
 * on this property. PATCHes the chosen contact with `add_role`
 * referencing the current property.
 *
 * Picker filters client-side by name / email. Capped at 200 contacts
 * server-side (search will only see the highest-scoring 200). For
 * workspaces above that we'll add server-side `?q=` later.
 */
export function AttachContactDialog({
  propertyId,
  propertyAddress,
  onClose,
}: AttachContactDialogProps) {
  const router = useRouter()
  const [role, setRole] = useState<RoleChoice>('seller')
  const [contactId, setContactId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/contacts')
      .then((r) => r.json())
      .then((data: { contacts?: ContactOption[] }) => setContacts(data.contacts ?? []))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) =>
      [c.first_name, c.last_name, c.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [contacts, search])

  async function handleSubmit() {
    if (!contactId || saving) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        add_role: { type: role, property_id: propertyId },
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data?.error ?? 'Could not attach contact')
      setSaving(false)
      return
    }
    router.refresh()
    onClose()
  }

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
            <div style={eyebrowStyle}>Attach contact</div>
            <div className="font-display" style={titleStyle}>
              Connect a contact to {propertyAddress}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtnStyle}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </header>

        <div style={bodyStyle}>
          {/* Role picker */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <RoleCard
              label="Vendor"
              desc="You represented them on a sale of this property"
              Icon={Home}
              active={role === 'seller'}
              onClick={() => setRole('seller')}
            />
            <RoleCard
              label="Buyer"
              desc="You represented them on a buy of this property"
              Icon={KeyRound}
              active={role === 'buyer'}
              onClick={() => setRole('buyer')}
            />
          </div>

          {/* Contact search + picker */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: '#FFFFFF',
              border: '1.5px solid rgba(140,123,107,0.3)',
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            <Search style={{ width: 14, height: 14, color: '#8C7B6B' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts by name or email…"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 13,
                color: '#1A1612',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>

          {loading ? (
            <div style={{ padding: '20px 8px', display: 'flex', alignItems: 'center', gap: 8, color: '#8C7B6B', fontSize: 12 }}>
              <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              Loading your contacts…
            </div>
          ) : filtered.length === 0 ? (
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
              {search.trim().length > 0
                ? `No contacts match "${search}".`
                : "Your book is empty — add a contact first."}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
              {filtered.map((c) => {
                const identity = deriveIdentity(c)
                const initials = makeInitials(c)
                const fullName =
                  [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                  c.email ||
                  'Unnamed contact'
                const selected = c.id === contactId
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setContactId(c.id)}
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
                    <PersonAvatar initials={initials} identity={identity} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#1A1612',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fullName}
                      </div>
                      {c.email && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#8C7B6B',
                            marginTop: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.email}
                        </div>
                      )}
                    </div>
                    {selected && <Check style={{ width: 15, height: 15, color: '#C4622D', flexShrink: 0 }} />}
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!contactId || saving}
              style={{
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
                cursor: !contactId || saving ? 'not-allowed' : 'pointer',
                opacity: !contactId || saving ? 0.5 : 1,
                fontFamily: 'var(--font-body)',
              }}
            >
              {saving ? (
                <>
                  <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                  Attaching…
                </>
              ) : (
                <>
                  <ArrowRight style={{ width: 13, height: 13 }} />
                  Attach as {role === 'seller' ? 'Vendor' : 'Buyer'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
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
        <div style={{ fontSize: 11, color: '#8C7B6B', lineHeight: 1.4, marginTop: 2 }}>
          {desc}
        </div>
      </div>
    </button>
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
  width: 'min(520px, 100%)',
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
  fontSize: 20,
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
}
