'use client'

import { useState } from 'react'
import { Mail, Link2, Calendar } from 'lucide-react'
import { HelpModal, type HelpKind } from '@/components/onboarding/help-modal'
import { CardLabel } from '@/components/ui/card-label'

interface Props {
  snippet: string
  snippetKey: string
  appUrl: string
}

export function InstallHelp({ snippet, snippetKey, appUrl }: Props) {
  const [helpOpen, setHelpOpen] = useState<HelpKind | null>(null)

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
      <CardLabel>Need a hand installing it?</CardLabel>
      <p className="mb-3.5 text-sm text-[var(--fg-secondary)]">
        Not the one who installs scripts? Pick the path that fits.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setHelpOpen('email')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] transition-colors hover:border-[var(--color-terracotta)] hover:text-[var(--color-terracotta-text)]"
        >
          <Mail size={14} /> Send to your web person
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen('share')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] transition-colors hover:border-[var(--color-terracotta)] hover:text-[var(--color-terracotta-text)]"
        >
          <Link2 size={14} /> Share install link
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen('book')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] transition-colors hover:border-[var(--color-terracotta)] hover:text-[var(--color-terracotta-text)]"
        >
          <Calendar size={14} /> Book a 15-min call
        </button>
      </div>

      <HelpModal
        kind={helpOpen}
        snippet={snippet}
        snippetKey={snippetKey}
        appUrl={appUrl}
        onClose={() => setHelpOpen(null)}
      />
    </div>
  )
}
