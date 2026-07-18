'use client'

import * as React from 'react'
import { Label } from '../../primitives/label.js'
import { cn } from '../../lib/utils.js'

/**
 * Shared field-shell primitives (issue #709).
 *
 * Every field component composes its label / help / error rhythm from these
 * pieces so that spacing, typography, and status colours are identical across
 * text, integer, checkbox, select, timestamp, password, relationship, json,
 * image/file, and combobox fields. All visual values resolve through theme
 * tokens — `text-muted-foreground`, `text-destructive`, `text-warning`, and the
 * radius/typography tokens the underlying primitives consume. No hardcoded
 * status colours live here or in any field that uses this shell.
 *
 * These parts carry stable `data-slot` names (`field`, `field-label`,
 * `field-help`, `field-error`, `field-warning`, `field-value`) so a plain-CSS
 * restyle can target them, and every part merges a caller `className` via `cn`.
 */

export interface FieldRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Read view uses a tighter rhythm than the editable stack. */
  mode?: 'read' | 'edit'
}

/** Outer wrapper providing the field's vertical rhythm. */
export const FieldRoot = React.forwardRef<HTMLDivElement, FieldRootProps>(
  ({ className, mode = 'edit', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="field"
      className={cn(mode === 'read' ? 'space-y-1' : 'space-y-2', className)}
      {...props}
    />
  ),
)
FieldRoot.displayName = 'FieldRoot'

export interface FieldLabelProps extends React.ComponentPropsWithoutRef<typeof Label> {
  /** Renders the required marker (`*`) after the label text. */
  required?: boolean
  /** Muted styling used by read views. */
  muted?: boolean
}

/** Field label with a consistent required marker. */
export function FieldLabel({ required, muted, className, children, ...props }: FieldLabelProps) {
  return (
    <Label
      data-slot="field-label"
      className={cn(muted && 'text-muted-foreground', className)}
      {...props}
    >
      {children}
      {required && (
        <span data-slot="field-required" className="ml-1 text-destructive">
          *
        </span>
      )}
    </Label>
  )
}

/** Secondary help / description text below the control. */
export function FieldHelp({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-help"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

/** Destructive validation message. */
export function FieldError({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p data-slot="field-error" className={cn('text-sm text-destructive', className)} {...props} />
  )
}

/** Non-blocking warning message (e.g. an in-progress invalid JSON edit). */
export function FieldWarning({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p data-slot="field-warning" className={cn('text-sm text-warning', className)} {...props} />
  )
}

/** Read-mode scalar value display shared by field read views. */
export function FieldReadValue({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="field-value" className={cn('text-sm', className)} {...props} />
}
