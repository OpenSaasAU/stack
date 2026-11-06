'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../lib/utils.js'

const ComboboxCloseContext = React.createContext<(() => void) | null>(null)

interface ComboboxNavigationValue {
  listId: string
  listRef: React.RefObject<HTMLDivElement | null>
  inputRef: React.RefObject<HTMLInputElement | null>
  activeId: string | null
  setActiveId: (id: string | null) => void
  /** Bring `activeId` back in line with the options now rendered. */
  syncActive: () => void
  /** The next `syncActive` chooses again, even if the active option survived. */
  retarget: () => void
  move: (pick: (options: HTMLElement[], current: number) => HTMLElement | undefined) => void
  commit: () => void
}

const ComboboxNavigationContext = React.createContext<ComboboxNavigationValue | null>(null)

function useComboboxNavigation(): ComboboxNavigationValue {
  const navigation = React.useContext(ComboboxNavigationContext)
  if (!navigation) throw new Error('Combobox parts must be rendered inside ComboboxContent')
  return navigation
}

function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null) {
  if (typeof ref === 'function') ref(node)
  else if (ref) ref.current = node
}

/**
 * The option Enter takes when the user has not moved. A server search unions the
 * current value into its results, so a typed query starts at the top of the
 * results rather than on the value.
 */
function defaultOption(options: HTMLElement[], query: string): HTMLElement | undefined {
  const choices = options.filter((option) => option.dataset.auxiliary === undefined)
  const selected =
    query === '' ? choices.find((option) => option.getAttribute('aria-selected') === 'true') : null
  return selected ?? choices[0]
}

/**
 * Mounted inside the popover content, so each opening starts over. DOM focus
 * stays on the search input: `aria-activedescendant` names the active option,
 * and Enter clicks it, so a keyboard selection runs the option's own `onClick`.
 */
function ComboboxNavigation({ children }: { children: React.ReactNode }) {
  const listId = React.useId()
  const listRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const shouldRetarget = React.useRef(true)

  const enabledOptions = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ) ?? [],
    )

  const syncActive = () => {
    const options = enabledOptions()
    if (!shouldRetarget.current && options.some((option) => option.id === activeId)) return
    shouldRetarget.current = false
    setActiveId(defaultOption(options, inputRef.current?.value.trim() ?? '')?.id ?? null)
  }

  const move: ComboboxNavigationValue['move'] = (pick) => {
    const options = enabledOptions()
    const next = pick(
      options,
      options.findIndex((option) => option.id === activeId),
    )
    if (next) setActiveId(next.id)
  }

  const commit = () => {
    enabledOptions()
      .find((option) => option.id === activeId)
      ?.click()
  }

  React.useLayoutEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <ComboboxNavigationContext
      value={{
        listId,
        listRef,
        inputRef,
        activeId,
        setActiveId,
        syncActive,
        retarget: () => {
          shouldRetarget.current = true
        },
        move,
        commit,
      }}
    >
      {children}
    </ComboboxNavigationContext>
  )
}

function Combobox({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <ComboboxCloseContext value={() => setOpen(false)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen} {...props} />
    </ComboboxCloseContext>
  )
}

const ComboboxTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ className, children, onKeyDown, ...props }, ref) => (
  <PopoverPrimitive.Trigger
    ref={ref}
    data-slot="combobox-trigger"
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 font-sans text-sm ring-offset-background transition-[color,box-shadow] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.currentTarget.click()
      }
    }}
    {...props}
  >
    {children}
    <svg
      aria-hidden="true"
      className="ml-2 h-4 w-4 shrink-0 opacity-50"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 9l4-4 4 4m0 6l-4 4-4-4"
      />
    </svg>
  </PopoverPrimitive.Trigger>
))
ComboboxTrigger.displayName = PopoverPrimitive.Trigger.displayName

const ComboboxContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, children, align = 'start', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="combobox-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-h-[var(--radix-popover-content-available-height)] w-full max-w-[calc(100vw-1rem)] min-w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-md border border-border bg-popover p-0 font-sans text-popover-foreground shadow-md outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    >
      <ComboboxNavigation>{children}</ComboboxNavigation>
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
))
ComboboxContent.displayName = PopoverPrimitive.Content.displayName

const ComboboxSearch = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, onChange, onKeyDown, 'aria-label': ariaLabel = 'Search', ...props }, ref) => {
  const close = React.useContext(ComboboxCloseContext)
  const { listId, inputRef, activeId, retarget, move, commit } = useComboboxNavigation()

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move((options, current) => options[(current + 1) % options.length])
        break
      case 'ArrowUp':
        event.preventDefault()
        move((options, current) => options[(current < 1 ? options.length : current) - 1])
        break
      case 'Home':
        event.preventDefault()
        move((options) => options[0])
        break
      case 'End':
        event.preventDefault()
        move((options) => options[options.length - 1])
        break
      case 'Enter':
        event.preventDefault()
        // The press that opened the picker can still be held down when focus lands here.
        if (!event.repeat) commit()
        break
      case 'Tab':
        // The popover loops focus, and this input is its only tab stop.
        event.preventDefault()
        close?.()
        break
    }
  }

  return (
    <div className="flex items-center border-b border-border px-3">
      <svg
        aria-hidden="true"
        className="mr-2 h-4 w-4 shrink-0 opacity-50"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        ref={(node) => {
          inputRef.current = node
          assignRef(ref, node)
        }}
        data-slot="combobox-search"
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={true}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId ?? undefined}
        autoComplete="off"
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 font-sans text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onChange={(event) => {
          retarget()
          onChange?.(event)
        }}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </div>
  )
})
ComboboxSearch.displayName = 'ComboboxSearch'

const ComboboxList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { listId, listRef, syncActive } = useComboboxNavigation()

    React.useLayoutEffect(syncActive)

    return (
      <div
        ref={(node) => {
          listRef.current = node
          assignRef(ref, node)
        }}
        id={listId}
        role="listbox"
        data-slot="combobox-list"
        className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
        {...props}
      >
        {children}
      </div>
    )
  },
)
ComboboxList.displayName = 'ComboboxList'

/**
 * The picker's status line, for a search in flight or an empty result. Keep it
 * mounted beside `ComboboxList` and pass `null` when there is nothing to say: a
 * live region announces changes only, and a listbox may hold nothing but options.
 */
const ComboboxEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children = 'No results found.', ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      data-slot="combobox-empty"
      className={cn(children ? 'py-6 text-center text-sm text-muted-foreground' : null, className)}
      {...props}
    >
      {children}
    </div>
  ),
)
ComboboxEmpty.displayName = 'ComboboxEmpty'

export interface ComboboxItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  disabled?: boolean
  /** An action beside the choices, such as clearing the value: the arrows reach it, but it is never active by default. */
  auxiliary?: boolean
}

const ComboboxItem = React.forwardRef<HTMLDivElement, ComboboxItemProps>(
  ({ className, children, selected, disabled, auxiliary, id, onPointerMove, ...props }, ref) => {
    const { activeId, setActiveId } = useComboboxNavigation()
    const generatedId = React.useId()
    const optionId = id ?? generatedId

    return (
      <div
        ref={ref}
        id={optionId}
        role="option"
        aria-selected={selected === true}
        aria-disabled={disabled || undefined}
        data-slot="combobox-item"
        data-active={optionId === activeId ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        data-auxiliary={auxiliary ? '' : undefined}
        className={cn(
          'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none wrap-anywhere',
          'hover:bg-accent hover:text-accent-foreground',
          'data-[active]:bg-accent data-[active]:text-accent-foreground data-[active]:ring-2 data-[active]:ring-inset data-[active]:ring-ring',
          'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          selected && 'pr-8 font-medium',
          className,
        )}
        onPointerMove={(event) => {
          onPointerMove?.(event)
          if (!disabled) setActiveId(optionId)
        }}
        {...props}
      >
        {selected && (
          <span
            aria-hidden="true"
            className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </span>
        )}
        {children}
      </div>
    )
  },
)
ComboboxItem.displayName = 'ComboboxItem'

const ComboboxSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="combobox-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  ),
)
ComboboxSeparator.displayName = 'ComboboxSeparator'

export {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearch,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxSeparator,
}
