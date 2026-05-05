'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'

export function AddContactDialog() {
  const [open, setOpen]       = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const router = useRouter()

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
  })

  function reset() {
    setForm({ first_name: '', last_name: '', email: '', phone: '' })
    setError(null)
  }

  function close() { reset(); setOpen(false) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.first_name.trim() && !form.email.trim()) {
      setError('Enter at least a name or email.')
      return
    }
    setSaving(true)
    setError(null)

    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.')
      return
    }

    close()
    router.refresh()
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 16px',
          borderRadius: '7px',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.35)',
          color: '#1A1612',
          fontSize: '13px',
          fontWeight: 500,
          fontFamily: 'var(--font-body)',
          cursor: 'pointer',
        }}
      >
        <Plus style={{ width: '14px', height: '14px' }} />
        Add contact
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(26,22,18,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={e => { if (e.target === e.currentTarget) close() }}
        >
          <div
            style={{
              background: '#FAF7F2',
              borderRadius: '12px',
              padding: '28px',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 20px 40px rgba(26,22,18,0.18)',
              position: 'relative',
            }}
          >
            {/* Close */}
            <button
              onClick={close}
              style={{
                position: 'absolute', top: '16px', right: '16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#8C7B6B', padding: '4px',
              }}
            >
              <X style={{ width: '16px', height: '16px' }} />
            </button>

            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 600, color: '#1A1612', marginBottom: '4px' }}>
              Add contact
            </h2>
            <p style={{ fontSize: '13px', color: '#8C7B6B', marginBottom: '20px' }}>
              Horace will start watching for this person on your website.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label="First name" value={form.first_name} placeholder="Sarah"
                  onChange={v => setForm(f => ({ ...f, first_name: v }))} />
                <Field label="Last name" value={form.last_name} placeholder="Thompson"
                  onChange={v => setForm(f => ({ ...f, last_name: v }))} />
              </div>
              <Field label="Email" type="email" value={form.email} placeholder="sarah@example.com"
                onChange={v => setForm(f => ({ ...f, email: v }))} />
              <Field label="Phone" type="tel" value={form.phone} placeholder="0412 345 678"
                onChange={v => setForm(f => ({ ...f, phone: v }))} />

              {error && (
                <p style={{ fontSize: '12px', color: '#C4622D' }}>{error}</p>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', justifyContent: 'flex-end' }}>
                <button
                  type="button" onClick={close}
                  style={{
                    padding: '8px 16px', borderRadius: '7px',
                    background: 'none', border: '1px solid rgba(140,123,107,0.35)',
                    color: '#8C7B6B', fontSize: '13px', fontWeight: 500,
                    fontFamily: 'var(--font-body)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  style={{
                    padding: '8px 20px', borderRadius: '7px',
                    background: '#1A1612', border: 'none',
                    color: '#FAF7F2', fontSize: '13px', fontWeight: 500,
                    fontFamily: 'var(--font-body)', cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {saving && <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} />}
                  {saving ? 'Adding…' : 'Add contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, value, placeholder, type = 'text', onChange }: {
  label: string
  value: string
  placeholder?: string
  type?: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8C7B6B' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          height: '36px', padding: '0 10px',
          borderRadius: '6px',
          border: '1px solid rgba(140,123,107,0.3)',
          background: '#fff',
          fontSize: '13px', color: '#1A1612',
          fontFamily: 'var(--font-body)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}
