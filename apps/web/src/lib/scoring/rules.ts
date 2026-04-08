import type { ScoringRule } from './types'

// V1 defaults — calibrated to match spec signal weights using available event types.
// Tuned with real data via agent_settings.scoring_config overrides per agent.
//
// Mapping to spec signal weights:
//   form_submit    → 50  (appraisal submitted)
//   return_visit   → 30  (repeat location/appraisal interest)
//   campaign_click → 25  (direct engagement / multiple enquiries)
//   property_view  →  5  (listing interest)
//   scroll_depth   →  2  (engaged content reading)
//   page_view      →  1  (general browsing)
export const DEFAULT_SCORING_RULES: ScoringRule[] = [
  { event_type: 'page_view',      points: 1,  max_per_session: 5  },
  { event_type: 'property_view',  points: 5,  max_per_session: 10 },
  { event_type: 'form_submit',    points: 50, max_per_session: 1  },
  { event_type: 'scroll_depth',   points: 2,  conditions: { pct_gte: 90 }, max_per_session: 1 },
  { event_type: 'return_visit',   points: 30, max_per_session: 1  },
  { event_type: 'campaign_click', points: 25, max_per_session: 1  },
]
