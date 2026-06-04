'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

/**
 * Cal.com booking modal — a dark-overlay dialog wrapping the cal embed iframe
 * (`embed=true&layout=month_view`). Shared by /support and the /manifesto CTA so
 * there's one booking-modal implementation. Escape closes; body scroll locks
 * while open.
 */
export function BookingModal({
  href,
  onClose,
  label = 'Book a 1:1',
}: {
  href: string
  onClose: () => void
  label?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const sep = href.includes('?') ? '&' : '?'
  const embedSrc = `${href}${sep}embed=true&layout=month_view`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(26,22,18,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 820,
          height: 'min(80vh, 720px)',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.25)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(26,22,18,0.3)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(250,247,242,0.9)',
            border: '1px solid rgba(140,123,107,0.25)',
            borderRadius: 8,
            color: '#5E5246',
            cursor: 'pointer',
          }}
        >
          <X style={{ width: 16, height: 16 }} aria-hidden />
        </button>
        <iframe
          src={embedSrc}
          title={label}
          loading="lazy"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
    </div>
  )
}
