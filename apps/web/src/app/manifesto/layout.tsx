import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Horace manifesto — Win more listings, lose fewer',
  description:
    "The interest isn't missing — it's invisible. Here's how Horace reads the trail vendors leave on your own website, so you win more listings and lose fewer.",
}

export default function ManifestoLayout({ children }: { children: React.ReactNode }) {
  return children
}
