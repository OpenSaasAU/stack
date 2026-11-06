'use client'

import * as React from 'react'
import { Label } from '../../primitives/label.js'
import { cn } from '../../lib/utils.js'

/**
 * Shared field-shell primitives (issue #709). Every field component composes
 * its label / help / error rhythm from these pieces, and all visual values
 * resolve through theme tokens — no hardcoded status colours live here or in
 * any field that uses this shell.
 *
 * These parts carry stable `data-slot` names so a plain-CSS restyle can target
 * them, and every part merges a caller `className` via `cn`.
 */

export interface FieldRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Read view uses a tighter rhythm than the editable stack. */
  mode?: 'read' | 'edit'
}

/** The `id` of the label for the control with this `id`. */
export function fieldLabelId(id: string): string {
  return `${id}-label`
}

/**
 * The `id` of the element inside a button control that shows its current value.
 * A `<label for>` would replace that text as the button's name, so such a control
 * is named by `aria-labelledby` from this and {@link fieldLabelId}.
 */
export function fieldValueId(id: string): string {
  return `${id}-value`
}

/** The `id` of the help text for the control with this `id`. */
export function fieldHelpId(id: string): string {
  return `${id}-help`
}

/** The `id` of the error message for the control with this `id`. */
export function fieldErrorId(id: string): string {
  return `${id}-error`
}

/**
 * The ARIA attributes tying a control to its error and help text, which must be
 * rendered with {@link fieldErrorId} and {@link fieldHelpId}. A form moves focus
 * to the first control marked `aria-invalid` after a failed submit.
 *
 * @example
 * ```tsx
 * <input id={id} {...describeField(id, { error, helpText })} />
 * {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
 * {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
 * ```
 */
export function describeField(
  id: string,
  { error, helpText }: { error?: string; helpText?: string },
): { 'aria-invalid': true | undefined; 'aria-describedby': string | undefined } {
  const described = [error && fieldErrorId(id), helpText && fieldHelpId(id)].filter(Boolean)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described.length > 0 ? described.join(' ') : undefined,
  }
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

/** Non-blocking warning message. */
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
