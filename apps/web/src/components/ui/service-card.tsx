'use client'

import * as React from 'react'
import { ChevronUp, Settings2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge, type BadgeProps } from './badge'
import { Button } from './button'

export interface ServiceCardProps {
  /** A lucide icon node, or a single letter for a wordmark. */
  logo?: React.ReactNode
  name: string
  summary?: React.ReactNode
  connected?: boolean
  statusVariant?: BadgeProps['variant']
  statusLabel?: string
  onConnect?: () => void
  defaultOpen?: boolean
  /** Nested manage panel, revealed when a connected card is expanded. */
  children?: React.ReactNode
  className?: string
}

/**
 * Integration row used on the merged Integrations surface. A connected service
 * expands in place to reveal its own settings rather than linking out.
 */
export function ServiceCard({
  logo,
  name,
  summary,
  connected,
  statusVariant = 'stone',
  statusLabel,
  onConnect,
  defaultOpen,
  children,
  className,
}: ServiceCardProps) {
  const [open, setOpen] = React.useState(!!defaultOpen)
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      <div className="flex items-center gap-3 p-[18px]">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[rgba(140,123,107,0.1)] font-serif text-base font-semibold text-[var(--fg-primary)] [&_svg]:size-[17px] [&_svg]:text-[var(--fg-secondary)]">
          {logo}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--fg-primary)]">
              {name}
            </span>
            {statusLabel && (
              <Badge variant={statusVariant} dot>
                {statusLabel}
              </Badge>
            )}
          </div>
          {summary && (
            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
              {summary}
            </div>
          )}
        </div>
        {connected ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? <ChevronUp /> : <Settings2 />}
            Manage
          </Button>
        ) : (
          <Button size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
      {open && connected && (
        <div className="border-t border-[var(--border-subtle)] bg-[rgba(140,123,107,0.04)] p-[18px]">
          {children}
        </div>
      )}
    </div>
  )
}
