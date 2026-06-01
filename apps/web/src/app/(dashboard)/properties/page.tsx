import { ReferenceTables } from '@/components/reference/reference-tables'
import { makeStubProperties } from '@/components/reference/stub-data'
import { getWorkspaceName } from '@/lib/reference/workspace-name'

/* Reference tables (substrate layer) — read-only contacts + properties.
 *
 * Replaces the previous rich properties view with the design-handoff substrate
 * surface — the properties block only (contacts lives on /contacts). UI-first
 * phase: rows come from the deterministic stub generator — swap `makeStub*()`
 * for server-paginated queries when wiring real data. */

export default async function PropertiesPage() {
  const workspaceName = await getWorkspaceName()
  return <ReferenceTables properties={makeStubProperties()} workspaceName={workspaceName} />
}
