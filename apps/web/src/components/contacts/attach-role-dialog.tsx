'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, Check, CircleDashed, Home, KeyRound, Loader2, Search, X } from 'lucide-react'
import { PropertyThumb, toneFor } from '@/lib/design/badges'

type RoleChoice = 'seller' | 'buyer' | 'landlord'

interface PropertyOption {
  id: string
  street_number: string | null
  street_name: string | null
  suburb: string | null
}

interface AttachRoleDialogProps {
  contactId: string
  contactFirstName: string | null
  onClose: () => void
}

/**
 * Lightweight modal that attaches a Seller/Buyer role to a contact via
 * PATCH /api/contacts/[id] with `{ add_role: { type, property_id } }`.
 * Used from the contact detail page header. Mirrors the role + property
 * steps of AddContactDialog but lives standalone for that surface.
 */
export function AttachRoleDialog({
  contactId,
  contactFirstName,
  onClose,
}: AttachRoleDialogProps) {
  const router = useRouter()
  const [role, setRole] = useState<RoleChoice>('seller')
  const [propertyId, setPropertyId] = useState<string | null>(null)
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/properties')
      .then((r) => r.json())
      .then((data: { properties?: PropertyOption[] }) => {
        setProperties(data.properties ?? [])
      })
      .catch(() => setProperties([]))
      .finally(() => setLoading(false))
  }, [])

  // Client-side filter over the loaded list. GET /api/properties caps at
  // 100 rows (ordered by recency), so the whole workspace is in memory and
  // searching never needs a round-trip. Matches street + suburb.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return properties
    return properties.filter((p) =>
      [p.street_number, p.street_name, p.suburb]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [properties, query])

  // Reset the keyboard cursor whenever the result set changes under it.
  useEffect(() => {
    setHighlight(0)
  }, [query])

  // Keep the highlighted row visible as the cursor moves through a
  // scrolled list.
  useEffect(() => {
    const node = listRef.current?.children[highlight] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = filtered[highlight]
      if (p) setPropertyId(p.id)
    }
  }

  async function handleSubmit() {
    if (!propertyId || saving) return
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
      setError(data?.error ?? 'Could not attach role')
      setSaving(false)
      return
    }

    router.refresh()
    onClose()
  }

  const nameForTitle = contactFirstName ?? 'this contact'

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
          width: 'min(520px, 100%)',
          maxHeight: '90vh',
          background: '#FAF7F2',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(26,22,18,0.32)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', padding: '22px 24px 4px', gap: 12 }}>
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
              Attach role
            </div>
            <div
              className="font-display"
              style={{
                fontSize: 20,
                fontWeight: 500,
                color: '#1A1612',
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
              }}
            >
              Connect {nameForTitle} to a property
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
              alignSelf: 'flex-start',
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </header>

        <div style={{ padding: '18px 24px 18px', flex: 1, overflowY: 'auto' }}>
          {/* Role buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            <RoleCard
              label="Vendor"
              desc="You represented them on a sale"
              Icon={Home}
              active={role === 'seller'}
              onClick={() => setRole('seller')}
            />
            <RoleCard
              label="Buyer"
              desc="You represented them on a buy"
              Icon={KeyRound}
              active={role === 'buyer'}
              onClick={() => setRole('buyer')}
            />
            <RoleCard
              label="Landlord"
              desc="They own a rental property"
              Icon={Building2}
              active={role === 'landlord'}
              onClick={() => setRole('landlord')}
            />
          </div>

          {/* Property picker */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: '#5E5246',
              marginBottom: 8,
              letterSpacing: '0.04em',
            }}
          >
            Which property?
          </div>

          {!loading && properties.length > 0 && (
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 14,
                  height: 14,
                  color: '#8C7B6B',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search your properties…"
                aria-label="Search properties"
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 33px',
                  background: '#FFFFFF',
                  border: '1.5px solid rgba(140,123,107,0.18)',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#1A1612',
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                }}
              />
            </div>
          )}

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
              <CircleDashed style={{ width: 13, height: 13, marginBottom: 4, color: '#8C7B6B' }} />
              <div>
                No properties in your workspace yet. Add one from{' '}
                <a href="/properties/new" style={{ color: '#C4622D', fontWeight: 500 }}>
                  Properties
                </a>{' '}
                first.
              </div>
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
              No properties match “{query.trim()}”. Try a different street or suburb.
            </div>
          ) : (
            <div
              ref={listRef}
              style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4, maxHeight: 260, overflowY: 'auto' }}
            >
              {filtered.map((p, i) => {
                const address = [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || 'Address pending'
                const selected = p.id === propertyId
                const highlighted = i === highlight
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPropertyId(p.id)}
                    onMouseEnter={() => setHighlight(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '8px 12px',
                      background: highlighted && !selected ? 'rgba(196,98,45,0.06)' : '#FFFFFF',
                      border: `1.5px solid ${selected ? '#C4622D' : highlighted ? 'rgba(196,98,45,0.4)' : 'rgba(140,123,107,0.18)'}`,
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!propertyId || saving}
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
                cursor: !propertyId || saving ? 'not-allowed' : 'pointer',
                opacity: !propertyId || saving ? 0.5 : 1,
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
                  Attach role
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
        <div style={{ fontSize: 11, color: '#8C7B6B', lineHeight: 1.4, marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  )
}
