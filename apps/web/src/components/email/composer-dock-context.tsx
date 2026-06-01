'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type {
  ComposerDockContextValue,
  OpenComposerOptions,
} from '@/lib/email/composer-dock-types'

/**
 * ComposerDockContext — global access to the tracked-email composer docks
 * (HOR-354). The Stream signal action, the contact-detail header, and the
 * Companion drawer all call `useComposerDock().openComposer({...})`.
 *
 * MULTIPLE docks can be open at once (Gmail-style): each new send stacks to
 * the left of the previous one, clearing the Companion (handled by the mount).
 * Opening a send to a contact that already has a dock open re-focuses the
 * existing one (expands it if collapsed) rather than spawning a duplicate —
 * so the dock id is the contact id.
 *
 * The provider owns the open list; each dock instance owns its own assist
 * state machine. State is ephemeral — lost on reload, matching the Companion.
 */

export interface OpenComposerEntry {
  /** Stable id — the contact id, so a second open to the same contact dedupes. */
  id: string
  payload: OpenComposerOptions
  /** Bumped when openComposer re-targets an already-open dock, so it re-focuses. */
  focusNonce: number
}

interface ComposerDockInternalValue extends ComposerDockContextValue {
  entries: OpenComposerEntry[]
}

const ComposerDockInternalContext = createContext<ComposerDockInternalValue | null>(null)

export function ComposerDockProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<OpenComposerEntry[]>([])

  const openComposer = useCallback((opts: OpenComposerOptions) => {
    setEntries((prev) => {
      const existing = prev.find((e) => e.id === opts.contactId)
      if (existing) {
        // Re-focus the open dock (the mount/dock expands on focusNonce change).
        return prev.map((e) =>
          e.id === opts.contactId ? { ...e, focusNonce: e.focusNonce + 1 } : e,
        )
      }
      // New dock — appended, so it stacks to the left of earlier ones.
      return [...prev, { id: opts.contactId, payload: opts, focusNonce: 0 }]
    })
  }, [])

  const closeComposer = useCallback((id?: string) => {
    setEntries((prev) => (id ? prev.filter((e) => e.id !== id) : prev.slice(0, -1)))
  }, [])

  const value = useMemo<ComposerDockInternalValue>(
    () => ({
      open: entries.length > 0,
      entries,
      openComposer,
      closeComposer,
    }),
    [entries, openComposer, closeComposer],
  )

  return (
    <ComposerDockInternalContext.Provider value={value}>
      {children}
    </ComposerDockInternalContext.Provider>
  )
}

/**
 * Public hook — entry points use this to open the composer. Throws outside
 * the provider so a missing mount surfaces loudly in dev.
 */
export function useComposerDock(): ComposerDockContextValue {
  const value = useContext(ComposerDockInternalContext)
  if (!value) {
    throw new Error('useComposerDock must be called inside <ComposerDockProvider>')
  }
  const { open, openComposer, closeComposer } = value
  return { open, openComposer, closeComposer }
}

/**
 * Internal hook — only `ComposerDockMount` should use this. Exposes the full
 * open list so the mount can render + position every dock.
 */
export function useComposerDockInternal(): ComposerDockInternalValue {
  const value = useContext(ComposerDockInternalContext)
  if (!value) {
    throw new Error('useComposerDockInternal must be called inside <ComposerDockProvider>')
  }
  return value
}
