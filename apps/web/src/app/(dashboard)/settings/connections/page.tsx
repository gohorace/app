import { redirect } from 'next/navigation'

// HOR-329: Connections merged into the unified Integrations surface.
export default function ConnectionsPage() {
  redirect('/settings/integrations')
}
