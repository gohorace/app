export type EventType =
  | 'page_view'
  | 'property_view'
  | 'form_submit'
  | 'scroll_depth'
  | 'return_visit'
  | 'campaign_click'

export interface ScoringRule {
  event_type: EventType
  points: number
  max_per_session?: number
  conditions?: {
    pct_gte?: number // for scroll_depth events
  }
}

export interface ScoringRuleOverride {
  [event_type: string]: Partial<ScoringRule>
}

export interface ScoreResult {
  delta: number
  newScore: number
  appliedRules: Array<{ event_type: EventType; points: number; count: number }>
}

import type { Json } from '@/types/database.types'

export interface IncomingEvent {
  id?: string
  session_id: string
  event_type: EventType
  properties: Json
  occurred_at?: string
}
