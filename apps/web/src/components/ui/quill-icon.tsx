/**
 * QuillIcon — the on-brand mark for the Horace companion trigger and every
 * "Ask Horace" CTA across v2. Lucide doesn't ship a Quill, so v2.0 uses
 * Feather as a stand-in. HOR-254 commissions the custom 24×24 SVG; the swap
 * happens here and only here — a single import point keeps every consumer
 * untouched.
 */
import { Feather, type LucideProps } from 'lucide-react'
import { forwardRef } from 'react'

export const QuillIcon = forwardRef<SVGSVGElement, LucideProps>(function QuillIcon(props, ref) {
  return <Feather ref={ref} {...props} />
})
