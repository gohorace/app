import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { OutreachReview } from '@/components/outreach/outreach-review'

export const dynamic = 'force-dynamic'

/**
 * HOR-389 · Outreach review surface. Opens the three drafts (email / SMS /
 * call notes) for a contact, grounded in matched site content. Auth + workspace
 * scoping are handled by the (dashboard) layout and the drafts API (which 404s
 * a contact that isn't the caller's).
 */
export default function OutreachReviewPage({ params }: { params: { contactId: string } }) {
  return (
    <div className="min-h-full">
      <div className="border-b border-border px-4 py-3">
        <Link href="/digest" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back
        </Link>
      </div>
      <OutreachReview contactId={params.contactId} />
    </div>
  )
}
