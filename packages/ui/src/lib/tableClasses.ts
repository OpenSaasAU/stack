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

/** Lays a table row out as a labelled card below `md`. Each cell names its column in `data-label`. */
export const CARD_ROW =
  'max-md:relative max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-lg max-md:border-0 max-md:p-3 max-md:pr-16 max-md:ring-1 max-md:ring-border'
export const CARD_CELL =
  'max-md:block max-md:min-w-0 max-md:p-0 max-md:text-left max-md:break-words max-md:before:block max-md:before:text-xs max-md:before:font-medium max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]'
export const CARD_TITLE_CELL =
  'max-md:order-first max-md:col-span-2 max-md:text-base max-md:before:hidden'
export const CARD_PINNED_CELL = 'max-md:absolute max-md:top-3 max-md:p-0'

/** Holds a full-width message to the visible part of a table wider than a phone. */
export const VISIBLE_TABLE_MESSAGE = 'max-md:sticky max-md:left-0 max-md:max-w-[calc(100vw-2rem)]'
