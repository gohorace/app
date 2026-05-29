import { redirect } from 'next/navigation'

// HOR-329: Email exclusions rehomed under the Gmail card on Integrations.
export default function EmailExclusionsPage() {
  redirect('/settings/integrations')
}
