'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Note, NoteTeammate, NotesTarget } from './types'

/**
 * useNotes — client hook for the NotesThread (HOR-252). Mirrors the
 * use-lists.ts shape: a single-source fetcher + explicit mutations that
 * refetch. One GET returns notes + teammates + currentAgentId.
 */
export function useNotes(target: NotesTarget) {
  const [notes, setNotes] = useState<Note[]>([])
  const [teammates, setTeammates] = useState<NoteTeammate[]>([])
  const [currentAgentId, setCurrentAgentId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)

  const qs = target.contactId
    ? `contactId=${target.contactId}`
    : `propertyId=${target.propertyId}`

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/notes?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setNotes(data.notes ?? [])
      setTeammates(data.teammates ?? [])
      setCurrentAgentId(data.currentAgentId ?? '')
    } catch (err) {
      console.warn('[use-notes] fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [qs])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const createNote = useCallback(
    async (input: { body: string; mentions: string[] }) => {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...target, ...input }),
      })
      if (res.status === 503) {
        setTableMissing(true)
        return false
      }
      if (!res.ok) return false
      await refetch()
      return true
    },
    [target, refetch],
  )

  const resolveNote = useCallback(
    async (id: string, resolved: boolean) => {
      await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolved }),
      })
      await refetch()
    },
    [refetch],
  )

  const editNote = useCallback(
    async (id: string, body: string) => {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) await refetch()
      return res.ok
    },
    [refetch],
  )

  return { notes, teammates, currentAgentId, loading, tableMissing, refetch, createNote, resolveNote, editNote }
}
