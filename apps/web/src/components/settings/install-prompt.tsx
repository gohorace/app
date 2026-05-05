'use client'

import { useEffect, useState } from 'react'
import { Share, MoreVertical, Plus, X } from 'lucide-react'

type Platform = 'ios' | 'android' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  )
}

export function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState<Platform>('other')

  useEffect(() => {
    if (isStandalone()) return
    if (localStorage.getItem('horace-install-dismissed')) return
    const p = detectPlatform()
    if (p === 'other') return
    setPlatform(p)
    setShow(true)
  }, [])

  function dismiss() {
    localStorage.setItem('horace-install-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div style={{
      background: '#FAF7F2',
      border: '1px solid rgba(140,123,107,0.2)',
      borderRadius: '12px',
      padding: '16px 18px',
      position: 'relative',
    }}>
      {/* Dismiss */}
      <button
        onClick={dismiss}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          color: '#8C7B6B',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          lineHeight: 0,
        }}
        aria-label="Dismiss"
      >
        <X style={{ width: '14px', height: '14px' }} />
      </button>

      {/* Heading */}
      <p style={{
        fontSize: '13px',
        fontWeight: 600,
        color: '#1A1612',
        marginBottom: '10px',
        paddingRight: '20px',
      }}>
        Add Horace to your home screen
      </p>

      {platform === 'ios' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Step n={1} icon={<Share style={{ width: '13px', height: '13px' }} />}>
            Tap the <strong>Share</strong> button at the bottom of Safari
          </Step>
          <Step n={2}>
            Scroll down and tap <strong>Add to Home Screen</strong>
          </Step>
          <Step n={3} icon={<Plus style={{ width: '13px', height: '13px' }} />}>
            Tap <strong>Add</strong> — Horace will appear on your home screen
          </Step>
          <p style={{ fontSize: '11px', color: '#8C7B6B', marginTop: '4px' }}>
            Must be opened in Safari, not Chrome or another browser.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Step n={1} icon={<MoreVertical style={{ width: '13px', height: '13px' }} />}>
            Tap the <strong>⋮ menu</strong> in the top-right corner of Chrome
          </Step>
          <Step n={2}>
            Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>
          </Step>
          <Step n={3}>
            Tap <strong>Install</strong> — Horace will appear on your home screen
          </Step>
        </div>
      )}
    </div>
  )
}

function Step({
  n,
  icon,
  children,
}: {
  n: number
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: 'rgba(196,98,45,0.12)',
        color: '#C4622D',
        fontSize: '10px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: '1px',
      }}>
        {icon ?? n}
      </div>
      <p style={{ fontSize: '13px', color: '#2E2823', lineHeight: 1.5, margin: 0 }}>
        {children}
      </p>
    </div>
  )
}
