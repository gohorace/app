/**
 * Horace companion — shared types for messages, actions, and the
 * conversation state owned by `CompanionProvider`.
 *
 * The brain is server-side (HOR-271): the drawer calls `requestReply`
 * (`respond.ts`) → `POST /api/companion/respond` → `lib/ai/companion.ts`,
 * which grounds every reply in the agent's real data. These types are the
 * wire shape shared across that boundary.
 */

export type ActionKind = 'draft-email' | 'add-to-list' | 'dismiss' | 'create-inspection' | 'edit-identity'

interface BaseAction {
  kind: ActionKind
  target: string
}

export interface DraftEmailAction extends BaseAction {
  kind: 'draft-email'
  subject: string
  body: string
  /** Optional contact id when the action is anchored to a known contact. */
  contactId?: string
}

export interface AddToListAction extends BaseAction {
  kind: 'add-to-list'
  listName: string
  /** Optional contact + list ids when known. v2.0 typically falls back to
   *  the AddToListSheet flow, which resolves these from the workspace. */
  contactId?: string
  listId?: string
}

export interface DismissAction extends BaseAction {
  kind: 'dismiss'
  /** Opaque scope key, e.g. `digest:contact:<id>` or
   *  `property-suggestion:<property-id>`. v2.0 may omit this; the action
   *  still renders the confirm card, but the backend insert is skipped. */
  scope?: string
  reason?: string
}

export interface CreateInspectionAction extends BaseAction {
  kind: 'create-inspection'
  when: string
  token: string
}

/**
 * Spoken/NLU identity edit (HOR-246 amendment, Phase 2b). The agent says
 * "set Dan's phone to 0412…"; Horace parses it into this action and the drawer
 * shows a parse-confirmation before anything is written. Writes only
 * agent-supplied fields — never the observed email.
 *
 * `field` is limited to `display_name` / `phone` (clean string writes).
 * Suburb is intentionally excluded from the spoken path: it maps to a
 * residence *address*, which a bare spoken string can't resolve — suburb edits
 * stay in the structured form (Phase 2a), which uses AddressAutocomplete.
 */
export interface EditIdentityAction extends BaseAction {
  kind: 'edit-identity'
  contactId: string
  field: 'display_name' | 'phone'
  value: string
  /** The observed email, echoed in the confirm card's safety inset so the
   *  agent sees the locked fact stays untouched. Populated server-side. */
  lockedNote?: string
}

export type CompanionAction =
  | DraftEmailAction
  | AddToListAction
  | DismissAction
  | CreateInspectionAction
  | EditIdentityAction

export interface MessageReference {
  label: string
  /** Internal route, e.g. `/contacts/sarah-thompson`. */
  route: string
}

export type MessageKind = 'agent' | 'horace' | 'system'

interface BaseMessage {
  kind: MessageKind
  text: string
}

export interface AgentMessage extends BaseMessage {
  kind: 'agent'
}

export interface HoraceMessage extends BaseMessage {
  kind: 'horace'
  /** Optional italic Playfair follow-on inside the same bubble. */
  italics?: string
  references?: MessageReference[]
  /** When set, the drawer renders an `ActionConfirm` card under the bubble
   *  and pauses the composer until the agent confirms or cancels. */
  action?: CompanionAction
}

export interface SystemMessage extends BaseMessage {
  kind: 'system'
}

export type CompanionMessage = AgentMessage | HoraceMessage | SystemMessage

/** Compact prior-turn shape sent to the brain for multi-turn memory.
 *  Only agent + horace turns (system pills are dropped); text only. */
export interface ConversationTurn {
  role: 'agent' | 'horace'
  text: string
}

/**
 * Structured context when the companion opens *focused* on a single digest
 * signal — the card's "Ask". Lets the drawer greet by name and seed the
 * signal's `read` as Horace's opener without parsing it back out of the
 * context label, and gates which contextual chips make sense. The header's
 * "Ask Horace" omits this for the general day-rundown entry.
 *
 * `identity` mirrors `SignalIdentity` in `digest/signal-card.tsx`; it is
 * re-declared here as a plain union so the companion layer stays free of a
 * component import (the shapes are structurally identical).
 */
export interface CompanionSignalContext {
  /** The signal's contact id — anchors the `digest:contact:<id>` scope. */
  contactId: string
  /** Display name, or a placeholder ("Someone in …") for anon/ambient. */
  name: string
  /** The signal's Horace-voiced read — seeded as the opener's italic line. */
  read: string
  /** Identity state — drives whether draft/list chips are offered. */
  identity?: 'known' | 'probable' | 'anonymous' | 'ambient'
  /** Suburb / area string, when known. */
  suburb?: string | null
}

/**
 * Identity-edit context (HOR-246 amendment, Phase 2a). When the companion is
 * opened with this, the drawer renders the structured `IdentityEditForm`
 * instead of the conversation — the decided edit surface for agent-supplied
 * identity. Observed facts (the email) are carried for display only and stay
 * read-only; the form writes the agent-supplied fields via PATCH.
 */
export interface EditIdentityContext {
  contactId: string
  /** The field the agent arrived from — gets the focus ring. */
  focusField?: 'name' | 'phone' | 'suburb'
  /** Current agent-supplied values (prefill). */
  displayName: string | null
  phone: string | null
  suburb: string | null
  /** Observed email + its provenance ("seen via …") — shown locked. */
  email: string | null
  seenLabel: string
}

export interface OpenCompanionOptions {
  /** Initial prompt to render as the agent's first message. Triggers an
   *  auto-response from Horace 600ms later. Omit to open with just the
   *  greeting + suggested prompts. */
  prompt?: string
  /** Context label rendered in the drawer header (`Context · <label>`).
   *  Drives both the greeting and the suggested-prompt chips. When omitted
   *  the provider derives a default from the current pathname (or from
   *  `signal`, when focused). */
  contextLabel?: string
  /** When set, the drawer opens focused on this digest signal — Horace's
   *  opener carries the signal's `read` and the chips become contextual.
   *  No auto-reply fires; the read is already computed, so the opener is
   *  Horace-led and the agent drives from there. */
  signal?: CompanionSignalContext
  /** When set, the drawer opens the identity-edit form (HOR-246 Phase 2a)
   *  instead of the conversation. */
  edit?: EditIdentityContext
}

export interface CompanionContextValue {
  open: boolean
  contextLabel: string | undefined
  openCompanion: (opts?: OpenCompanionOptions) => void
  closeCompanion: () => void
}
