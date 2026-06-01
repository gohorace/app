'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function CopyButton({
  text,
  className,
  label,
}: {
  text: string
  className?: string
  /** When set, renders a text label beside the icon (e.g. "Copy"). */
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending reset timer on unmount to avoid a setState-after-unmount.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard can reject in insecure contexts or when permission is denied;
      // swallow rather than throwing an unhandled rejection.
      return
    }
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className={cn(label ? 'h-7 gap-1.5 px-3' : 'h-7 w-7 p-0', className)}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label ? (copied ? 'Copied' : label) : null}
    </Button>
  )
}
