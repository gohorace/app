import { SectionHeading } from '@/components/ui/section-heading'
import { Badge } from '@/components/ui/badge'

// Ordered high → low to match the design (most valuable signals first).
const rules = [
  { event_type: 'form_submit', label: 'Contact form submission', points: 20, cap: '1 per session' },
  { event_type: 'campaign_click', label: 'Campaign link click', points: 10, cap: '1 per session' },
  { event_type: 'return_visit', label: 'Return visit', points: 5, cap: '1 per session' },
  { event_type: 'property_view', label: 'Property listing view', points: 3, cap: '10 per session' },
  { event_type: 'page_view', label: 'Page view', points: 1, cap: '5 per session' },
  { event_type: 'scroll_depth', label: 'Scroll to 90% of page', points: 1, cap: '1 per session' },
]

export default function ScoringPage() {
  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8">
        <div className="max-w-[660px]">
          <SectionHeading
            title="Scoring rules"
            description="How intent points are awarded as a visitor moves through your site."
          />

          <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
            <div className="flex items-center border-b border-[var(--border-subtle)] px-[18px] py-[11px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
              <span className="flex-1">Activity</span>
              <span className="w-[120px]">Cap</span>
              <span className="w-16 text-right">Points</span>
            </div>
            {rules.map((rule, i) => (
              <div
                key={rule.event_type}
                className={
                  'flex items-center px-[18px] py-[15px]' +
                  (i === rules.length - 1 ? '' : ' border-b border-[var(--border-subtle)]')
                }
              >
                <span className="flex-1 text-sm font-medium text-[var(--fg-primary)]">
                  {rule.label}
                </span>
                <span className="w-[120px] font-mono text-xs text-[var(--fg-secondary)]">
                  {rule.cap}
                </span>
                <span className="w-16 text-right">
                  <Badge variant="accent">+{rule.points}</Badge>
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs italic text-[var(--fg-tertiary)]">
            These weightings are tuned by Horace and apply across your workspace.
          </p>
        </div>
      </div>
    </div>
  )
}
