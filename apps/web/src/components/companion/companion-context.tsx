'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { deriveContextLabel } from '@/lib/companion/derive-context-label'
import type {
  CompanionContextValue,
  OpenCompanionOptions,
} from '@/lib/companion/types'

/**
 * CompanionContext — global access to the companion drawer.
 *
 * Pages call `useCompanion().openCompanion({ prompt, contextLabel })`
 * from any "Ask Horace" / "Draft with Horace" / dismiss CTA. The
 * provider owns ephemeral state (open + active prompt + contextLabel);
 * the drawer rebuilds its conversation from that on each open. State
 * is lost on reload — persistence is HOR-257 (v2-D4).
 *
 * `currentPrompt` is exposed (not in the value type) so the drawer can
 * consume it once on mount and treat subsequent composer messages as
 * follow-ups. Marked internal — pages should never read it directly.
 */

interface InternalCompanionState {
  open: boolean
  prompt: string | undefined
  /** Caller-supplied label, takes precedence over the pathname default. */
  contextLabelOverride: string | undefined
  /** Token bumped on every `openCompanion(...)` so the drawer knows to
   *  rebuild the conversation even when called with the same arguments. */
  openToken: number
}

interface CompanionInternalValue extends CompanionContextValue {
  /** Latest prompt — consumed once by the drawer on open. */
  prompt: string | undefined
  openToken: number
}

const CompanionInternalContext = createContext<CompanionInternalValue | null>(null)

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [state, setState] = useState<InternalCompanionState>({
    open: false,
    prompt: undefined,
    contextLabelOverride: undefined,
    openToken: 0,
  })

  const openCompanion = useCallback((opts?: OpenCompanionOptions) => {
    setState((prev) => ({
      open: true,
      prompt: opts?.prompt,
      contextLabelOverride: opts?.contextLabel,
      openToken: prev.openToken + 1,
    }))
  }, [])

  const closeCompanion = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const contextLabel = useMemo(() => {
    return state.contextLabelOverride ?? deriveContextLabel(pathname)
  }, [state.contextLabelOverride, pathname])

  const value = useMemo<CompanionInternalValue>(
    () => ({
      open: state.open,
      prompt: state.prompt,
      openToken: state.openToken,
      contextLabel,
      openCompanion,
      closeCompanion,
    }),
    [state.open, state.prompt, state.openToken, contextLabel, openCompanion, closeCompanion],
  )

  return (
    <CompanionInternalContext.Provider value={value}>
      {children}
    </CompanionInternalContext.Provider>
  )
}

/**
 * Public hook — pages use this to open the companion. Throws if called
 * outside the provider so a missing mount surfaces loudly during dev.
 */
export function useCompanion(): CompanionContextValue {
  const value = useContext(CompanionInternalContext)
  if (!value) {
    throw new Error('useCompanion must be called inside <CompanionProvider>')
  }
  // Surface only the public API — keep `prompt` / `openToken` internal.
  const { open, contextLabel, openCompanion, closeCompanion } = value
  return { open, contextLabel, openCompanion, closeCompanion }
}

/**
 * Internal hook — only `CompanionMount` should use this. Exposes the
 * raw prompt + openToken so the drawer can rebuild its conversation
 * each time `openCompanion` is invoked, even with identical args.
 */
export function useCompanionInternal(): CompanionInternalValue {
  const value = useContext(CompanionInternalContext)
  if (!value) {
    throw new Error(
      'useCompanionInternal must be called inside <CompanionProvider>',
    )
  }
  return value
}
