/**
 * deriveContextLabel — default contextLabel for the companion drawer
 * when a screen hasn't supplied one explicitly via `openCompanion({…})`.
 *
 * Pages that have a loaded entity (Contact name, Property address) should
 * pass `contextLabel` directly when opening the drawer from one of their
 * buttons. This helper covers the case where the agent clicks the global
 * `CompanionTrigger` and the provider has to guess from the URL alone.
 */

const ROUTE_LABEL: Record<string, string> = {
  '/digest': 'Digest',
  '/market': 'Market',
  '/contacts': 'Contacts',
  '/properties': 'Properties',
  '/lists': 'Lists',
  '/inspections': 'Inspections',
  '/settings': 'Settings',
  '/support': 'Support',
}

export function deriveContextLabel(pathname: string | null): string | undefined {
  if (!pathname) return undefined

  // Exact match — top-level dashboard routes.
  if (ROUTE_LABEL[pathname]) return ROUTE_LABEL[pathname]

  // Settings sub-pages keep the parent label.
  if (pathname.startsWith('/settings/')) return 'Settings'

  // Entity routes — fall back to the parent label. The page itself
  // should override with the loaded entity name (e.g. `Contact: Sarah
  // Thompson`) when it triggers `openCompanion` from a button.
  if (pathname.startsWith('/contacts/')) return 'Contacts'
  if (pathname.startsWith('/properties/')) return 'Properties'
  if (pathname.startsWith('/lists/')) return 'Lists'
  if (pathname.startsWith('/inspections/')) return 'Inspections'

  return undefined
}
