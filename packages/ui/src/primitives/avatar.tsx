import * as React from 'react'

import { cn } from '../lib/utils.js'
import { getAvatarTone, getInitials } from '../lib/avatar.js'

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The name / label the avatar represents. Drives the initials shown, the
   * deterministic tone, and the accessible label — so the bubble is
   * identifiable and screen-reader-legible from one prop.
   */
  name: string
  /**
   * When true, the bubble is purely decorative and hidden from the
   * accessibility tree (`aria-hidden`, no `role`/`aria-label`). Use this
   * whenever adjacent visible text already conveys the identity — e.g. the
   * label beside it in a table cell — so the avatar does not add its name to
   * that cell's accessible name (which would break exact-name lookups and read
   * the identity twice). Defaults to `false`: a standalone avatar is a labelled
   * image.
   */
  decorative?: boolean
}

/**
 * Initials avatar primitive (issue #735). A small, circular bubble showing the
 * initials of `name`, tinted with a deterministic Theme-token tone (never raw
 * hex — see {@link AVATAR_TONES}). It degrades gracefully: a missing or blank
 * `name` still renders a neutral "?" bubble rather than an empty circle.
 *
 * Accessibility: by default the bubble is a labelled image (`role="img"` +
 * `aria-label={name}`) with the initials text hidden, so a screen reader
 * announces the full name once, not the abbreviation. When `decorative`, it is
 * hidden from the accessibility tree entirely (for use beside visible label
 * text). Slot: `avatar`.
 */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ name, decorative = false, className, ...props }, ref) => {
    const trimmed = name?.trim() ?? ''
    const initials = getInitials(name ?? '')
    const tone = getAvatarTone(trimmed)

    const a11yProps = decorative
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': trimmed || 'Unknown' } as const)

    return (
      <span
        ref={ref}
        data-slot="avatar"
        {...a11yProps}
        className={cn(
          'inline-flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold uppercase',
          tone,
          className,
        )}
        {...props}
      >
        <span aria-hidden="true">{initials}</span>
      </span>
    )
  },
)
Avatar.displayName = 'Avatar'
