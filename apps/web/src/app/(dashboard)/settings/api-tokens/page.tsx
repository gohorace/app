import { redirect } from 'next/navigation'

// HOR-329: API tokens (MCP) merged into "API & developer access".
export default function ApiTokensPage() {
  redirect('/settings/api-and-data')
}
