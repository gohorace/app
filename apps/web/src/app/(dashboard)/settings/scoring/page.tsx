import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const defaultRules = [
  { event_type: 'page_view', label: 'Page view', points: 1, cap: '5 per session' },
  { event_type: 'property_view', label: 'Property listing view', points: 3, cap: '10 per session' },
  { event_type: 'form_submit', label: 'Contact form submission', points: 20, cap: '1 per session' },
  { event_type: 'scroll_depth', label: 'Scroll to 90% of page', points: 1, cap: '1 per session' },
  { event_type: 'return_visit', label: 'Return visit', points: 5, cap: '1 per session' },
  { event_type: 'campaign_click', label: 'Campaign link click', points: 10, cap: '1 per session' },
]

export default function ScoringPage() {
  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scoring rules</h1>
          <p className="text-muted-foreground">How points are awarded for lead activity</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Default scoring rules</CardTitle>
            <CardDescription>
              These rules apply to all leads. Custom overrides coming soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Activity</th>
                  <th className="px-6 py-3 font-medium text-right">Points</th>
                  <th className="px-6 py-3 font-medium text-right">Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {defaultRules.map((rule) => (
                  <tr key={rule.event_type}>
                    <td className="px-6 py-3 font-medium">{rule.label}</td>
                    <td className="px-6 py-3 text-right">
                      <Badge variant="secondary">+{rule.points}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right text-muted-foreground text-xs">
                      {rule.cap}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
