'use client'

import { useEffect } from 'react'

export function PushManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('[sw] registration failed', err))
  }, [])

  return null
}

export async function requestPushPermission(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const reg = await navigator.serviceWorker.ready

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set')
    return null
  }

  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  })
}

export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `Subscribe failed (${res.status})`)
  }
}

export async function removePushSubscription(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await fetch('/api/push/subscribe', { method: 'DELETE' })
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  // Unwrap surrounding quotes if the value was accidentally stored as "key" or 'key'
  let raw = base64String.trim()
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1)
  }
  // Strip any characters not valid in base64url
  const cleaned = raw.replace(/[^A-Za-z0-9\-_]/g, '')
  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4)
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/')
  try {
    const rawData = atob(base64)
    return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
  } catch (err) {
    throw new Error(
      `VAPID key is not valid base64. ` +
      `Raw length: ${base64String.length}, cleaned: "${cleaned.slice(0, 20)}…". ` +
      `Check NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel. Original error: ${err}`
    )
  }
}
