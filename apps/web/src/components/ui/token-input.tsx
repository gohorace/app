'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { Chip } from './chip'

export interface TokenInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Return false to reject a token on commit (e.g. invalid email). */
  validate?: (value: string) => boolean
  /** Normalise a token before it's stored (e.g. lowercase, trim). */
  transform?: (value: string) => string
  id?: string
  className?: string
}

/**
 * Free-text input that commits tokens on Enter or comma and renders them as
 * removable chips. Backspace on an empty field removes the last token.
 */
export function TokenInput({
  values,
  onChange,
  placeholder,
  validate,
  transform,
  id,
  className,
}: TokenInputProps) {
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = () => {
    const raw = draft.trim()
    if (!raw) return
    const value = transform ? transform(raw) : raw
    if (value && (!validate || validate(value)) && !values.includes(value)) {
      onChange([...values, value])
    }
    setDraft('')
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        'flex min-h-10 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5',
        className,
      )}
    >
      {values.map((v) => (
        <Chip key={v} onRemove={() => onChange(values.filter((x) => x !== v))}>
          {v}
        </Chip>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        placeholder={values.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !draft && values.length) {
            onChange(values.slice(0, -1))
          }
        }}
        onBlur={commit}
        className="min-w-[120px] flex-1 border-none bg-transparent text-sm text-[var(--fg-primary)] outline-none placeholder:text-[var(--fg-tertiary)]"
      />
    </div>
  )
}
