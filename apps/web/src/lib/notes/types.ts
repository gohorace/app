/**
 * HOR-252 — Notes (threaded comment log) shared types.
 */

export interface NoteTeammate {
  id: string
  name: string
  firstName: string
  role: string | null
  initials: string
}

export interface Note {
  id: string
  authorId: string
  authorName: string
  authorInitials: string
  authorRole: string | null
  body: string
  /** Resolved agent ids mentioned in the body. */
  mentions: string[]
  createdAt: string
  editedAt: string | null
  resolved: boolean
}

export interface NotesResponse {
  notes: Note[]
  teammates: NoteTeammate[]
  /** The current agent's id — drives "you" highlighting + author-only edit. */
  currentAgentId: string
}

/** Exactly one of contactId / propertyId is set. */
export interface NotesTarget {
  contactId?: string
  propertyId?: string
}
