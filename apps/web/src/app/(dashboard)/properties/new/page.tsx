import { redirect } from 'next/navigation'

/**
 * HOR-126: `/properties/new` is now a thin redirect to `/properties?add=1`,
 * which mounts the new Add Property modal on the list page. The URL is kept
 * working so external bookmarks / links don't break.
 */
export default function NewPropertyRedirect() {
  redirect('/properties?add=1')
}
