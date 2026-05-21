import type { Metadata } from 'next'

/**
 * HOR-294: brand-free chrome for prospect-facing Doorstep surfaces.
 *
 * The root layout's metadata is Horace's — favicon (`/favicon.svg`),
 * `manifest`, and `appleWebApp.title: 'Horace'`. On the neutral host, and on
 * the `/i` capture page wherever it's served, that would put the Horace mark
 * in the browser tab, on a home-screen save, and in a shared-link preview —
 * a breach of the invisibility invariant.
 *
 * Page-level metadata fields override the layout's, so spreading this into a
 * page's returned Metadata fully replaces the Horace icons/manifest/PWA title
 * with neutral "Doorstep" chrome — without making the root layout dynamic.
 */
export const neutralChrome: Metadata = {
  icons: { icon: '/doorstep-favicon.svg', apple: '/doorstep-favicon.svg' },
  manifest: '/doorstep.webmanifest',
  applicationName: 'Doorstep',
  appleWebApp: { capable: true, title: 'Doorstep', statusBarStyle: 'default' },
}
