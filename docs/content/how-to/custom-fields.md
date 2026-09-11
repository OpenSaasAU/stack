# Custom Field Components

Stack provides a flexible system for creating custom field components that integrate seamlessly with the admin UI. This guide covers how to create and register custom fields using two different approaches.

## Overview

Custom field components allow you to extend the built-in field types with specialized UI and behavior. OpenSaas supports two patterns for using custom components:

1. **Global Field Type Registration** - Register a reusable component once, use it across multiple fields
2. **Per-Field Component Override** - Specify a custom component for a single field

Both approaches give you full control over the field's appearance and behavior while maintaining type safety and integration with the admin UI.

## When to Use Custom Fields

Consider creating a custom field component when you need:

- **Specialized input methods** - Color pickers, rich text editors, date range pickers
- **Custom validation UI** - Real-time feedback, formatted input (phone numbers, credit cards)
- **Enhanced user experience** - Auto-complete, suggestions, drag-and-drop uploads
- **Domain-specific controls** - Geolocation pickers, WYSIWYG editors, code editors
- **Computed or derived values** - Slug generation, calculated fields

## Approach 1: Global Field Type Registration

Global registration is ideal for reusable field types that you'll use across multiple fields or lists.

### Step 1: Create the Field Component

Create a client component that accepts standard field props:

```tsx
// components/ColorPickerField.tsx
'use client'

import { cn } from '@opensaas/stack-ui/lib/utils'

export interface ColorPickerFieldProps {
  name: string
  value: string
  onChange: (value: string) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
}

export function ColorPickerField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
}: ColorPickerFieldProps) {
  // Read mode - display only
  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded border border-border"
            style={{ backgroundColor: value || '#000000' }}
          />
          <span className="text-sm text-muted-foreground">{value || 'No color selected'}</span>
        </div>
      </div>
    )
  }

  // Edit mode - interactive
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={name}
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'w-16 h-10 rounded border border-input cursor-pointer',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          disabled={disabled}
          className={cn(
            'flex-1 px-3 py-2 rounded-md border border-input',
            'bg-background text-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'disabled:opacity-50',
            error && 'border-destructive',
          )}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

### Step 2: Register the Component

Create a registration file that runs on the client:

```tsx
// lib/register-fields.ts
'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { ColorPickerField } from '../components/ColorPickerField'

// Register the component with a custom type name
registerFieldComponent('color', ColorPickerField)
```

### Step 3: Render the Registration from a Client Component

`page.tsx` is a server component, and a `'use client'` module only reaches the browser when
something in the tree **renders** it. A bare `import '../../../lib/register-fields'` from `page.tsx`
therefore registers nothing — the field falls back to "Unsupported field type", and nothing in
`generate`, `next build`, `tsc` or the test suite notices. Carry the import in a client component:

```tsx
// app/admin/[[...admin]]/FieldRegistration.tsx
'use client'

import '../../../lib/register-fields'

export function FieldRegistration() {
  return null
}
```

Then render it alongside the admin UI:

```tsx
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { FieldRegistration } from './FieldRegistration'

export default async function AdminPage(props: AdminPageProps) {
  return (
    <>
      <FieldRegistration />
      <AdminUI {...await adminProps(props)} />
    </>
  )
}
```

### Step 4: Use in Config

Reference the registered field type in your config:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    User: list({
      fields: {
        favoriteColor: text({
          ui: {
            fieldType: 'color', // References globally registered component
          },
        }),
        themeColor: text({
          ui: {
            fieldType: 'color', // Reuse the same component
          },
        }),
      },
    }),
  },
})
```

### Benefits of Global Registration

- **Reusability** - Define once, use everywhere
- **Consistency** - Same behavior across all instances
- **Maintainability** - Update in one place
- **Library Building** - Create organizational component libraries

## Approach 2: Per-Field Component Override

Per-field overrides are ideal for one-off customizations or field-specific behavior.

### Step 1: Create the Field Component

```tsx
// components/SlugField.tsx
'use client'

import { useState } from 'react'
import { cn } from '@opensaas/stack-ui/lib/utils'

export interface SlugFieldProps {
  name: string
  value: string
  onChange: (value: string) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
}

export function SlugField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
}: SlugFieldProps) {
  const [isAutoMode, setIsAutoMode] = useState(true)

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim()
  }

  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium">{label}</label>
        <code className="text-sm bg-muted px-2 py-1 rounded">/{value || 'no-slug'}</code>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">/</span>
        <input
          id={name}
          type="text"
          value={value || ''}
          onChange={(e) => {
            setIsAutoMode(false)
            onChange(generateSlug(e.target.value))
          }}
          placeholder="auto-generated-slug"
          disabled={disabled}
          className={cn(
            'flex-1 px-3 py-2 rounded-md border font-mono text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'disabled:opacity-50',
            error && 'border-destructive',
            isAutoMode && 'bg-muted text-muted-foreground italic',
          )}
        />
        {isAutoMode && <span className="text-xs text-muted-foreground">Auto</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        {isAutoMode
          ? 'Slug will be auto-generated from the title'
          : 'Manually set (only lowercase, numbers, and hyphens)'}
      </p>
    </div>
  )
}
```

### Step 2: Use Directly in Config

Pass the component directly in the field config:

```typescript
// opensaas.config.ts
import { SlugField } from './components/SlugField'

export default config({
  lists: {
    Post: list({
      fields: {
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
          ui: {
            component: SlugField, // Direct component reference
          },
        }),
      },
    }),
  },
})
```

### Benefits of Per-Field Override

- **Rapid prototyping** - Test ideas quickly
- **Field-specific behavior** - Custom logic for one field
- **No registration needed** - Simpler setup
- **Explicit dependency** - Clear what components are used where

## Field Component Interface

Every custom field component receives these props. `FieldComponentProps` is exported from `@opensaas/stack-ui`:

```typescript
type FieldComponentProps = {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
}
```

`value` and `onChange` are `unknown` because the registry holds components for every field type at once. Narrow them in your own props type rather than casting at each use — a `ColorPickerField` declares `value: string` and `onChange: (value: string) => void` and is still registrable, because `FieldComponent` widens to accept any component satisfying the base shape plus extra props.

Anything else in a field's `ui` config is passed through to the component as an additional prop, so declare the options your component reads alongside these.

### Key Requirements

1. **Handle both modes** - Implement both `read` and `edit` mode rendering
2. **Display errors** - Show validation errors when present
3. **Support disabled state** - Respect the disabled prop
4. **Show required indicator** - Mark required fields visually
5. **Accept custom options** - Support additional UI options from config

## Advanced Example: Slug Field with Auto-Generation

Here's a more complex example showing hooks integration:

```typescript
// opensaas.config.ts
export default config({
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
          ui: { fieldType: 'slug' },
        }),
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, item }) => {
          const result = { ...resolvedData }

          // Auto-generate slug from title if not provided
          if (operation === 'create' && !result.slug && result.title) {
            result.slug = result.title
              .toLowerCase()
              .replace(/[^\w\s-]/g, '')
              .replace(/\s+/g, '-')
              .replace(/--+/g, '-')
              .trim()
          }

          return result
        },
      },
    }),
  },
})
```

This combines:

- Custom UI component for better UX
- Server-side hook for automatic generation
- Validation to ensure uniqueness

## Comparison: When to Use Which Approach

| Scenario                           | Recommended Approach       | Why                                   |
| ---------------------------------- | -------------------------- | ------------------------------------- |
| Color picker for multiple fields   | Global Registration        | Reusable across User, Post, etc.      |
| Slug field (one per content type)  | Per-Field Override         | Specific to Post.slug                 |
| Rich text editor                   | Global Registration        | Common pattern, multiple use cases    |
| Custom computed field display      | Per-Field Override         | Unique calculation logic              |
| Phone number formatter             | Global Registration        | Standard format, many fields          |
| Special admin-only control         | Per-Field Override         | Single use case                       |
| Date range picker                  | Global Registration        | Library component, multiple fields    |
| Field with unique validation logic | Per-Field Override or Hook | Depends on whether UI or data focused |

## Working with Third-Party Field Packages

OpenSaas supports third-party field packages (like `@opensaas/stack-tiptap` for rich text editing). These packages provide:

1. **Field builder functions** - Functions like `richText()` to use in your config
2. **React components** - Pre-built UI components
3. **Type definitions** - TypeScript types for field configs
4. **Optional styles** - CSS for the field components

### Using Third-Party Fields

```typescript
// Install the package
// pnpm add @opensaas/stack-tiptap

// Import the field builder
import { richText } from '@opensaas/stack-tiptap/fields'

export default config({
  lists: {
    Post: list({
      fields: {
        content: richText({
          ui: {
            minHeight: 300,
            placeholder: 'Write your content...',
          },
        }),
      },
    }),
  },
})
```

### Creating Third-Party Field Packages

See the [packages/tiptap](https://github.com/OpenSaasAU/stack/tree/main/packages/tiptap) source code for a complete reference implementation.

Key requirements:

1. Implement `BaseFieldConfig` interface
2. Provide `getZodSchema()` and `getContractField()`, plus `outputType` when the field has no single column to be typed from — a virtual field, or one spanning several columns
3. Export field builder function and React component
4. Document client-side registration requirements

See the [Fields API reference](/docs/reference/fields-api) for each member's exact signature.

## Declaring What a Field's Output Hook Reads

A `resolveOutput` hook only sees what the read actually fetched. If yours reads a sibling column or a relation, declare it in `needs` — otherwise the field will work in the admin UI (which reads whole rows) and come back empty from a narrowed read.

Add `needs` to the field config your builder returns, or accept it from the caller and pass it through:

```typescript
import { z } from 'zod'
import type { BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'

export type DisplayNameField = BaseFieldConfig<TypeInfo> & {
  type: 'displayName'
}

export function displayName(options?: Omit<DisplayNameField, 'type'>): DisplayNameField {
  return {
    type: 'displayName',
    needs: ['firstName', 'lastName'],
    ...options,
    outputType: 'string',
    getContractField: () => ({ kind: 'computed' }),
    // A computed field accepts no input, so its input schema admits nothing.
    getZodSchema: () => z.never(),
    hooks: {
      resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
    },
  }
}
```

The rules `opensaas generate` enforces:

- Entries are **column keys on the same list** — stored columns and immediate relationship fields. No dotted paths, and never another computed field.
- A `needs` on a field with **no `resolveOutput` hook** is refused: nothing could consume it.
- Dependencies are **one hop and non-transitive**, and are **stripped from the result** unless the caller named them too — so declaring one never changes the shape of every read of the list.
- A relation dependency is **scoped by the Access Filter** like any other read, so write the hook to tolerate a session that cannot see it.

Because `needs` is typed as a plain `string[]` on `BaseFieldConfig` — third-party field builders are not generic over the list's `TypeInfo` — a misspelled entry is caught at `opensaas generate` rather than by the compiler. Test the field against a real config before publishing it. The full rules are in the [Fields API reference](/docs/reference/fields-api).

## Best Practices

### 1. Type Safety

Narrow the base props to the value type your component actually handles, and add the `ui` options it reads:

```typescript
import type { FieldComponentProps } from '@opensaas/stack-ui'

export interface MyFieldProps extends Omit<FieldComponentProps, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  palette?: readonly string[]
}
```

Narrowing in the props type is what keeps the component free of casts: the registry hands it an `unknown`, and the declaration is where that becomes a `string` once, in a place a reader can check.

### 2. Styling Consistency

Use the stack's utility classes and CSS variables:

```tsx
import { cn } from '@opensaas/stack-ui/lib/utils'
;<input
  className={cn(
    'px-3 py-2 rounded-md border border-input',
    'bg-background text-foreground',
    'focus:outline-none focus:ring-2 focus:ring-ring',
    error && 'border-destructive',
  )}
/>
```

### 3. Accessibility

Follow accessibility best practices:

```tsx
<label htmlFor={name}>{label}</label>
<input id={name} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} />
{error && <p id={`${name}-error`} role="alert">{error}</p>}
```

### 4. Mode Handling

Always implement both read and edit modes:

```tsx
if (mode === 'read') {
  return <ReadOnlyDisplay value={value} />
}

return <EditableInput value={value} onChange={onChange} />
```

### 5. Custom UI Options

Pass custom options through the field config:

In the config:

```typescript
richText({
  ui: {
    minHeight: 300,
    placeholder: 'Start writing...',
    enableMarkdown: true,
  },
})
```

`FieldRenderer` extracts `component` and `fieldType` from `ui` and passes everything else straight through, so the component declares them as ordinary props:

```tsx
interface RichTextFieldProps extends Omit<FieldComponentProps, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  minHeight?: number
  placeholder?: string
  enableMarkdown?: boolean
}

function RichTextField({
  minHeight,
  placeholder,
  enableMarkdown,
  ...baseProps
}: RichTextFieldProps) {
  return (
    <Editor
      {...baseProps}
      minHeight={minHeight}
      placeholder={placeholder}
      markdown={enableMarkdown}
    />
  )
}
```

## Examples and Next Steps

### Try These Custom Field Ideas

1. **Rich Text Editor** - WYSIWYG with formatting toolbar
2. **Image Upload** - Drag-and-drop with preview and cropping
3. **Tag Input** - Multi-value with autocomplete
4. **Geolocation Picker** - Interactive map for selecting coordinates
5. **Code Editor** - Syntax highlighting for code fields
6. **Date Range** - Start and end date selection
7. **File Upload** - Generic file upload with progress
8. **Color Palette** - Multiple color selection
9. **Markdown Editor** - Split view with preview
10. **URL Validator** - Real-time URL validation with preview

### Learn More

- View the [complete custom-field example](https://github.com/OpenSaasAU/stack/tree/main/examples/custom-field) on GitHub
- Explore [composability patterns](/docs/how-to/composability) for building custom dashboards
- Check out the [@opensaas/stack-tiptap](https://github.com/OpenSaasAU/stack/tree/main/packages/tiptap) package for a real-world example
- Read about [field types and validation](/docs/concepts/field-types) in the core documentation
- See the [Fields API reference](/docs/reference/fields-api) for every member of the field builder contract

## Troubleshooting

### Registration Not Working

**Problem**: Custom field not appearing in admin UI

**Solutions**:

1. Ensure registration file is imported in admin page
2. Check that component is marked with `'use client'`
3. Verify field type name matches registration
4. Check browser console for errors

### TypeScript Errors

**Problem**: Type errors when using custom component

**Solutions**:

1. Ensure component implements `FieldComponentProps`
2. Check that props interface is exported
3. Verify field config UI options match component props

### Styling Issues

**Problem**: Component doesn't match admin UI theme

**Solutions**:

1. Use CSS variables from the theme system
2. Import and use `cn()` utility for conditional classes
3. Check that Tailwind classes are being processed
4. Verify component uses design tokens (border-input, bg-background, etc.)
