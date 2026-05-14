'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ListPlus, Loader2, Plus, X } from 'lucide-react'
import { useLists, type ListRecord } from '@/lib/lists/use-lists'

// HOR-142  AddToListSheet — floating panel for adding contact(s) to a list.
//
// Rendered as a fixed-position overlay (scrim + panel) so it sits above the
// Digest signal card's Link wrapper without portal gymnastics. The trigger
// button stops propagation; the scrim closes on outside-click.
//
// Two modes:
//   • Single-contact (contactId set) — checkboxes pre-checked for existing
//     memberships; toggling adds/removes that single contact.
//   • Batch (contactIds set, contactId unset) — checkboxes always
//     unchecked; clicking adds the whole batch to the chosen list (the
//     Contacts grid surface from Slice 2 / HOR-143).
//
// Slice 1 ships single-contact only. The batch path is plumbed for HOR-143.

interface AddToListSheetProps {
  open: boolean
  onClose: () => void
  /** Single-contact mode. Mutually exclusive with `contactIds`. */
  contactId?: string
  /** Batch mode. Mutually exclusive with `contactId`. */
  contactIds?: string[]
  /** Caller display string for the sheet header — e.g. the contact name. */
  subjectLabel?: string
  /**
   * Fired after a successful add (toggle-on or new-list+add). Used by the
   * notifications stream to transition the moment card into its resolved
   * confirmation state. Receives the list that was just added to.
   */
  onAdded?: (list: ListRecord) => void
}

export function AddToListSheet({
  open,
  onClose,
  contactId,
  contactIds,
  subjectLabel,
  onAdded,
}: AddToListSheetProps) {
  const subjectIds = contactIds ?? (contactId ? [contactId] : [])
  const isBatch = (contactIds?.length ?? 0) > 1

  const { lists, loading, createList, addToList, removeFromList } = useLists({
    contactId: isBatch ? undefined : contactId,
  })

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  if (!open) return null

  async function withPending(listId: string, fn: () => Promise<unknown>) {
    setPending((prev) => new Set(prev).add(listId))
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(listId)
        return next
      })
    }
  }

  async function handleToggle(list: ListRecord) {
    if (subjectIds.length === 0) return
    if (isBatch) {
      // Batch always *adds* — we don't toggle off when N > 1 because that's
      // ambiguous. HOR-143 may add a "remove from list" separately.
      await withPending(list.id, () => addToList(list.id, subjectIds))
      onAdded?.(list)
      return
    }
    if (list.contact_is_member) {
      await withPending(list.id, () => removeFromList(list.id, subjectIds[0]))
    } else {
      await withPending(list.id, () => addToList(list.id, subjectIds))
      onAdded?.(list)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setError(null)
    try {
      const list = await createList({ name })
      // Immediately add the subject to the new list.
      if (subjectIds.length > 0) {
        await addToList(list.id, subjectIds)
        onAdded?.(list)
      }
      setNewName('')
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create list')
    }
  }

  const manualLists = lists.filter((l) => l.kind === 'manual')

  return (
    <div
      // Scrim. Stops click-through to the card link behind us.
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // Only close when the click started on the scrim itself, not on
        // bubbling from inside the panel.
        if (e.target === e.currentTarget) onClose()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(26,22,18,0.36)',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to list"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 12,
          boxShadow: '0 20px 48px rgba(26,22,18,0.18)',
          overflow: 'hidden',
          fontFamily: 'var(--font-body)',
          color: '#1A1612',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 18px 12px',
            borderBottom: '1px solid rgba(140,123,107,0.16)',
          }}
        >
          <div>
            <h3
              className="font-display"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              Add to list
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8C7B6B' }}>
              {isBatch
                ? `${subjectIds.length} contacts selected`
                : subjectLabel ?? 'Pick or create a list'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              color: '#5E5246',
              cursor: 'pointer',
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: '8px 0' }}>
          {/* Create row */}
          {creating ? (
            <form
              onSubmit={handleCreate}
              style={{
                padding: '10px 18px',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                borderBottom: '1px solid rgba(140,123,107,0.12)',
              }}
            >
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New list name"
                maxLength={80}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: 13,
                  fontFamily: 'var(--font-body)',
                  color: '#1A1612',
                  background: '#FFFFFF',
                  border: '1px solid rgba(140,123,107,0.28)',
                  borderRadius: 6,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                style={{
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#FAF7F2',
                  background: '#1A1612',
                  border: 'none',
                  borderRadius: 6,
                  cursor: newName.trim() ? 'pointer' : 'not-allowed',
                  opacity: newName.trim() ? 1 : 0.5,
                  fontFamily: 'var(--font-body)',
                }}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                }}
                style={{
                  padding: '8px 8px',
                  fontSize: 12,
                  color: '#5E5246',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(140,123,107,0.12)',
                color: '#1A1612',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'rgba(196,98,45,0.12)',
                  color: '#C4622D',
                }}
              >
                <Plus style={{ width: 14, height: 14 }} />
              </span>
              Create new list
            </button>
          )}

          {/* Existing lists */}
          {loading && lists.length === 0 ? (
            <div
              style={{
                padding: '18px',
                fontSize: 13,
                color: '#8C7B6B',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Loader2
                style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }}
              />
              Loading lists…
            </div>
          ) : manualLists.length === 0 ? (
            <div
              style={{
                padding: '18px',
                fontSize: 13,
                color: '#8C7B6B',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <ListPlus style={{ width: 14, height: 14 }} />
              No lists yet — create your first one above.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {manualLists.map((list) => {
                const isPending = pending.has(list.id)
                const isMember = !!list.contact_is_member
                return (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => void handleToggle(list)}
                      disabled={isPending}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 18px',
                        background: isMember ? 'rgba(61,82,70,0.06)' : 'transparent',
                        border: 'none',
                        cursor: isPending ? 'wait' : 'pointer',
                        fontFamily: 'var(--font-body)',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          border: isMember
                            ? '1px solid #3D5246'
                            : '1px solid rgba(140,123,107,0.4)',
                          background: isMember ? '#3D5246' : '#FFFFFF',
                          color: '#FAF7F2',
                          flexShrink: 0,
                        }}
                      >
                        {isPending ? (
                          <Loader2
                            style={{
                              width: 12,
                              height: 12,
                              animation: 'spin 1s linear infinite',
                              color: isMember ? '#FAF7F2' : '#5E5246',
                            }}
                          />
                        ) : (
                          isMember && <Check style={{ width: 12, height: 12 }} />
                        )}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: 'block',
                            fontSize: 13,
                            fontWeight: 500,
                            color: '#1A1612',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {list.name}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11,
                            color: '#8C7B6B',
                            marginTop: 1,
                          }}
                        >
                          {list.member_count ?? 0}{' '}
                          {list.member_count === 1 ? 'contact' : 'contacts'}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 18px',
              fontSize: 12,
              color: '#9C4A1F',
              background: 'rgba(196,98,45,0.06)',
              borderTop: '1px solid rgba(196,98,45,0.2)',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Tiny inline keyframes — the spinner is the only spinner in the
          component tree, no point hoisting to globals.css. */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
