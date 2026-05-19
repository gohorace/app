'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * useSidebarPref — per-device sidebar collapse preference.
 *
 * Stored in localStorage under `horace.sidebar.collapsed`. Per-device on
 * purpose (not workspace-wide): an agent's laptop and their phone may want
 * different defaults. The hook is intentionally simple — no Context, no
 * provider — every consumer mounts its own listener so the state stays
 * authoritative from localStorage on every paint.
 *
 * SSR-safe: defaults to `false` (expanded) on the server, then hydrates
 * from localStorage after mount. The first paint is always expanded;
 * a brief flicker is acceptable for an opt-in collapsed state.
 *
 * Used by `(dashboard)/layout.tsx` to pass `collapsed` + `onToggle` to
 * `<Sidebar />`. The `/market` first-visit flow (v2-M4) sets the value to
 * `true` once via the regular setter — no special API needed.
 */

const STORAGE_KEY = 'horace.sidebar.collapsed'
const STORAGE_EVENT = 'horace:sidebar-pref-change'

function readPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writePref(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
    // Custom event so other instances of the hook in the same tab stay in
    // sync — `storage` events only fire across tabs.
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT))
  } catch {
    // localStorage disabled (Safari private mode etc.) — degrade silently.
  }
}

export function useSidebarPref(): [boolean, () => void, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(false)

  // Hydrate from localStorage after mount + listen for cross-instance changes.
  useEffect(() => {
    setCollapsedState(readPref())
    function sync() {
      setCollapsedState(readPref())
    }
    window.addEventListener(STORAGE_EVENT, sync)
    window.addEventListener('storage', sync) // cross-tab
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      writePref(next)
      return next
    })
  }, [])

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    writePref(next)
  }, [])

  return [collapsed, toggle, setCollapsed]
}
