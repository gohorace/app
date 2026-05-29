import * as React from 'react'

import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

export interface CodeBlockProps {
  code: string
  className?: string
}

export function CodeBlock({ code, className }: CodeBlockProps) {
  return (
    <div
      className={cn(
        'relative rounded-md bg-[var(--color-ink)] p-4',
        className,
      )}
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words pr-16 font-mono text-xs leading-relaxed text-[rgba(245,240,232,0.85)]">
        {code}
      </pre>
      <CopyButton
        text={code}
        label="Copy"
        className="absolute right-3 top-3 border border-[rgba(245,240,232,0.2)] bg-[rgba(245,240,232,0.08)] text-[var(--color-cream)] hover:bg-[rgba(245,240,232,0.16)] hover:text-[var(--color-cream)]"
      />
    </div>
  )
}
