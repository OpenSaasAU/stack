/**
 * Avatar helpers (issue #735) — deterministic initials and colour for the
 * label-column avatar Cell. Both derive purely from the row's label string, so
 * the same row always renders the same bubble across pages and reloads.
 */

/**
 * The avatar colour palette — Theme-token-derived Tailwind class pairs, never
 * raw hex (per ADR-0015 / the #728 theming decision). Each entry pairs a tinted
 * token background with its readable foreground token, so avatars re-tint
 * automatically with a custom theme and in light/dark. A row is mapped to one
 * tone deterministically by {@link getAvatarTone}.
 */
export const AVATAR_TONES: readonly string[] = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-destructive/15 text-destructive',
  'bg-accent text-accent-foreground',
  'bg-secondary text-secondary-foreground',
]

/**
 * Derive up to two uppercase initials from a label.
 *
 * - Two or more words → first letter of the first and last word (e.g.
 *   "Ada Lovelace" → "AL").
 * - One word → its first two letters (e.g. "opensaas" → "OP").
 * - Empty / whitespace-only → "?" so the bubble never renders blank.
 *
 * Non-letter leading characters (an emoji, a digit) are kept as-is after
 * upper-casing, matching how a person scanning the column would read them.
 */
export function getInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    return [...words[0]].slice(0, 2).join('').toUpperCase()
  }
  const first = [...words[0]][0] ?? ''
  const last = [...words[words.length - 1]][0] ?? ''
  return (first + last).toUpperCase()
}

/**
 * Deterministically map a seed string to one of {@link AVATAR_TONES}. Uses a
 * small stable string hash (djb2-style) so the choice is stable across renders,
 * processes, and reloads — never `Math.random`. An empty seed maps to the first
 * tone.
 */
export function getAvatarTone(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    // `| 0` keeps the running value a 32-bit int (avoids float drift on long seeds).
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % AVATAR_TONES.length
  return AVATAR_TONES[index]
}
