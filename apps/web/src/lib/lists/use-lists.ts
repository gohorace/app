'use client'

import { useCallback, useEffect, useState } from 'react'

// HOR-142  useLists() — light client hook around /api/lists.
//
// No SWR / react-query dependency in the app yet; this is a single-source-of-
// truth fetcher with explicit `refetch`. Caller-side flow is the
// AddToListSheet:
//
//   const { lists, refetch, createList, addToList, removeFromList } =
//     useLists({ contactId })
//
// When `contactId` is provided, each list carries `contact_is_member` so the
// sheet can pre-check existing memberships.

export interface ListRecord {
  id: string
  name: string
  description: string | null
  kind: 'manual' | 'saved_filter'
  filter_state: Record<string, unknown> | null
  created_at: string
  updated_at: string
  agent_id: string
  member_count: number | null
  contact_is_member?: boolean
}

interface UseListsOptions {
  /** When set, the API returns `contact_is_member` per list for that contact. */
  contactId?: string
}

interface CreateListInput {
  name: string
  description?: string | null
  kind?: 'manual' | 'saved_filter'
  filter_state?: Record<string, unknown> | null
}

export function useLists({ contactId }: UseListsOptions = {}) {
  const [lists, setLists] = useState<ListRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const url = contactId
    ? `/api/lists?contact_id=${encodeURIComponent(contactId)}`
    : '/api/lists'

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      const json = (await res.json()) as { lists: ListRecord[] }
      setLists(json.lists ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load lists')
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const createList = useCallback(async (input: CreateListInput): Promise<ListRecord> => {
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `Could not create list (${res.status})`)
    }
    const json = (await res.json()) as { list: ListRecord }
    // Optimistically prepend so the sheet sees the new list immediately.
    setLists((prev) => [
      { ...json.list, contact_is_member: contactId ? false : undefined },
      ...prev,
    ])
    return json.list
  }, [contactId])

  const addToList = useCallback(
    async (listId: string, contactIds: string[]) => {
      const res = await fetch(`/api/lists/${listId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: contactIds }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Could not add to list (${res.status})`)
      }
      // Bump the local membership flag + count without a full refetch.
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? {
                ...l,
                member_count: (l.member_count ?? 0) + contactIds.length,
                contact_is_member:
                  contactId && contactIds.includes(contactId)
                    ? true
                    : l.contact_is_member,
              }
            : l,
        ),
      )
    },
    [contactId],
  )

  const removeFromList = useCallback(
    async (listId: string, contactIdToRemove: string) => {
      const res = await fetch(
        `/api/lists/${listId}/members/${contactIdToRemove}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Could not remove (${res.status})`)
      }
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId
            ? {
                ...l,
                member_count: Math.max(0, (l.member_count ?? 1) - 1),
                contact_is_member:
                  contactId === contactIdToRemove ? false : l.contact_is_member,
              }
            : l,
        ),
      )
    },
    [contactId],
  )

  return { lists, loading, error, refetch, createList, addToList, removeFromList }
}
