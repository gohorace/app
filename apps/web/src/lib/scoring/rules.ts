import type { ScoringRule } from './types'

export const DEFAULT_SCORING_RULES: ScoringRule[] = [
  { event_type: 'page_view',      points: 1,  max_per_session: 5  },
  { event_type: 'property_view',  points: 3,  max_per_session: 10 },
  { event_type: 'form_submit',    points: 20, max_per_session: 1  },
  { event_type: 'scroll_depth',   points: 1,  conditions: { pct_gte: 90 }, max_per_session: 1 },
  { event_type: 'return_visit',   points: 5,  max_per_session: 1  },
  { event_type: 'campaign_click', points: 10, max_per_session: 1  },
]
