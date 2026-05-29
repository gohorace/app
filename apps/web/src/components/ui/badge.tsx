import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        // Tonal status badges (Horace palette) used across the settings surface.
        accent:
          'border-transparent bg-[rgba(196,98,45,0.12)] font-medium text-[var(--color-terracotta)]',
        moss: 'border-transparent bg-[rgba(61,82,70,0.12)] font-medium text-[var(--color-moss)]',
        amber: 'border-transparent bg-[rgba(181,146,42,0.14)] font-medium text-[#8A6A00]',
        stone:
          'border-transparent bg-[rgba(140,123,107,0.12)] font-medium text-[var(--fg-secondary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const dotColors: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-primary-foreground',
  secondary: 'bg-secondary-foreground',
  destructive: 'bg-destructive-foreground',
  outline: 'bg-foreground',
  accent: 'bg-[var(--color-terracotta)]',
  moss: 'bg-[var(--color-moss)]',
  amber: 'bg-[var(--color-signal-mid)]',
  stone: 'bg-[var(--color-stone)]',
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading status dot, tinted to match the variant. */
  dot?: boolean
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            'size-[5px] shrink-0 rounded-full',
            dotColors[variant ?? 'default'],
          )}
        />
      )}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
