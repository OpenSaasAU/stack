import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../lib/utils.js'

const Combobox = PopoverPrimitive.Root

const ComboboxTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <PopoverPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    <svg
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
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-full min-w-[var(--radix-popover-trigger-width)] rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    >
      {children}
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
))
ComboboxContent.displayName = PopoverPrimitive.Content.displayName

const ComboboxSearch = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-3">
    <svg
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
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
))
ComboboxSearch.displayName = 'ComboboxSearch'

const ComboboxList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
      {...props}
    >
      {children}
    </div>
  ),
)
ComboboxList.displayName = 'ComboboxList'

const ComboboxEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children = 'No results found.', ...props }, ref) => (
    <div
      ref={ref}
      className={cn('py-6 text-center text-sm text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  ),
)
ComboboxEmpty.displayName = 'ComboboxEmpty'

const ComboboxItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { selected?: boolean }
>(({ className, children, selected, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
      'hover:bg-accent hover:text-accent-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      selected && 'bg-accent text-accent-foreground',
      className,
    )}
    {...props}
  >
    {selected && (
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )}
    {children}
  </div>
))
ComboboxItem.displayName = 'ComboboxItem'

const ComboboxSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
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
