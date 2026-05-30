import Link from 'next/link'
import { ArrowLeft, LifeBuoy, MessageCircle, ExternalLink } from 'lucide-react'
import { SectionHeading } from '@/components/ui/section-heading'
import { SettingRow } from '@/components/ui/setting-row'

export const dynamic = 'force-dynamic'

// NOTE (HOR-329): /help is a top-level route, not a section inside the
// settings shell, so it keeps a "Back to settings" link (the shell rail
// isn't present here). Card matches the prototype's HelpSection.
const HELP_LINKS = [
  {
    href: 'https://help.gohorace.com',
    icon: LifeBuoy,
    title: 'Help centre',
    desc: 'Step-by-step guides for every part of Horace.',
  },
  {
    href: 'mailto:support@gohorace.com',
    icon: MessageCircle,
    title: 'Talk to us',
    desc: 'Real people, usually within a few hours.',
  },
]

export default function HelpPage() {
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="mx-auto max-w-[660px] space-y-5 p-4 md:p-8">
        <div>
          <Link
            href="/settings"
            className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to settings
          </Link>
          <SectionHeading
            title="Help & guides"
            description="Walkthroughs and answers, whenever you need them."
          />
        </div>

        <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
          {HELP_LINKS.map(({ href, icon: Icon, title, desc }, i) => (
            <Link key={href} href={href} target="_blank" rel="noopener noreferrer" className="block">
              <SettingRow
                icon={<Icon />}
                title={title}
                description={desc}
                last={i === HELP_LINKS.length - 1}
              >
                <ExternalLink className="size-[15px] text-[var(--fg-tertiary)]" />
              </SettingRow>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
