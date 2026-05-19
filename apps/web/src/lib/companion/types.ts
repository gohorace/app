/**
 * Horace companion — shared types for messages, actions, and the
 * conversation state owned by `CompanionProvider`.
 *
 * Brain is pattern-matched + canned for v2.0 (see `respond.ts`). The shape
 * is deliberately LLM-shaped — a real Anthropic call can drop into the
 * same `respond()` signature in v2.x without consumers changing.
 */

export type ActionKind = 'draft-email' | 'add-to-list' | 'dismiss' | 'create-inspection'

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

export type CompanionAction =
  | DraftEmailAction
  | AddToListAction
  | DismissAction
  | CreateInspectionAction

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

export interface OpenCompanionOptions {
  /** Initial prompt to render as the agent's first message. Triggers an
   *  auto-response from Horace 600ms later. Omit to open with just the
   *  greeting + suggested prompts. */
  prompt?: string
  /** Context label rendered in the drawer header (`Context · <label>`).
   *  Drives both the greeting and the suggested-prompt chips. When omitted
   *  the provider derives a default from the current pathname. */
  contextLabel?: string
}

export interface CompanionContextValue {
  open: boolean
  contextLabel: string | undefined
  openCompanion: (opts?: OpenCompanionOptions) => void
  closeCompanion: () => void
}
