import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Horace handbook — Set up your site, take back your pipeline',
  description:
    "Your website already knows who's about to sell. Here's how Horace reads the trail vendors leave — and how to set your site up so he sees it all.",
}

export default function HandbookLayout({ children }: { children: React.ReactNode }) {
  return children
}
