'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClaudeButtonProps {
  prompt: string
  label?: string
  size?: 'sm' | 'default'
  className?: string
}

/**
 * Opens Claude in a new tab with a pre-filled prompt.
 * Uses claude.ai/new?q= to land the user directly in a relevant conversation.
 */
export function ClaudeButton({
  prompt,
  label = 'Explore with Claude',
  size = 'default',
  className,
}: ClaudeButtonProps) {
  const url = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg font-medium transition-all',
        'border border-[rgba(196,98,45,0.35)] text-[#C4622D]',
        'hover:bg-[rgba(196,98,45,0.06)] hover:border-[rgba(196,98,45,0.6)]',
        'hover:shadow-[0_2px_8px_rgba(196,98,45,0.12)]',
        size === 'sm'
          ? 'px-3 py-1.5 text-xs'
          : 'px-4 py-2 text-sm',
        className,
      )}
      style={{ transitionDuration: '180ms' }}
    >
      <Sparkles
        className={cn('shrink-0', size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')}
      />
      {label}
    </a>
  )
}
