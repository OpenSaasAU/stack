/**
 * Keeps a row's actions on screen while a table wider than a phone scrolls under
 * them. Pair it with a `before:` background naming the surface behind the table.
 *
 * Inheriting the row's background alone is not enough: a translucent one (hover, a
 * theme's zebra stripe) would show the cells scrolling underneath. So `::before`
 * is an opaque surface over the cell's own background, and `::after` repeats the
 * row's colour over that. `sticky` makes the cell the stacking context that keeps
 * both behind its content.
 */
export const STICKY_ACTIONS_CELL =
  'max-md:sticky max-md:right-0 max-md:bg-inherit max-md:before:absolute max-md:before:inset-0 max-md:before:-z-10 max-md:after:absolute max-md:after:inset-0 max-md:after:-z-10 max-md:after:bg-inherit'

/** Holds a full-width message to the visible part of a table wider than a phone. */
export const VISIBLE_TABLE_MESSAGE = 'max-md:sticky max-md:left-0 max-md:max-w-[calc(100vw-2rem)]'
