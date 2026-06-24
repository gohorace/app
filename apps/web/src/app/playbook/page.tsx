import type { Metadata } from 'next'
import PlaybookClient from './PlaybookClient'

export const metadata: Metadata = {
  title: 'The Horace playbook — Your website, working harder',
  description:
    'The companion to the manifesto. Eight principles for building a real estate website a vendor wants to move through — and one Horace can read for you.',
  openGraph: {
    title: 'The Horace playbook — Your website, working harder',
    description:
      'Eight principles for building a real estate website a vendor wants to move through — and one Horace can read for you.',
    type: 'article',
  },
}

export default function PlaybookPage() {
  return <PlaybookClient />
}
