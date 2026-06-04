import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: "Horace — how's your site actually doing?",
  description:
    "A 60-second look at your real-estate website: speed, mobile, forms, tracking, and the basics — in Horace's voice. Free, no login.",
}

// This surface overrides the app's dark-charcoal status bar with the audit
// page's warmer dark ground, so the iOS/Android chrome matches the page.
export const viewport: Viewport = {
  themeColor: '#211C18',
}

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return children
}
