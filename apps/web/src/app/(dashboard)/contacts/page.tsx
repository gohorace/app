import { ReferenceTables } from '@/components/reference/reference-tables'
import { makeStubContacts } from '@/components/reference/stub-data'
import { getWorkspaceName } from '@/lib/reference/workspace-name'

/* Reference tables (substrate layer) — read-only contacts + properties.
 *
 * Replaces the previous rich contacts grid with the design-handoff substrate
 * surface. UI-first phase: rows come from the deterministic stub generator.
 * To wire real data, swap `makeStub*()` for server-paginated queries returning
 * `ContactRow[]` / `PropertyRow[]` (sort + filter + limit/offset + total). The
 * dashboard layout still enforces auth + the active-subscription gate. */

export default async function ContactsPage() {
  const workspaceName = await getWorkspaceName()
  return <ReferenceTables contacts={makeStubContacts()} workspaceName={workspaceName} />
}
