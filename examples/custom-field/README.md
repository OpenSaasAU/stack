# Custom Field Components Example

This example demonstrates how to use custom field components in OpenSaas Stack using two different approaches:

1. **Global field type registration** - Register a custom component that can be reused across your application
2. **Per-field component override** - Override the default component for a specific field

## Features Demonstrated

### 1. Global Field Type Registration (`ColorPickerField`)

The `ColorPickerField` component is registered globally and used for multiple fields:

```typescript
// Register globally in opensaas.config.ts
import { registerFieldComponent } from "@opensaas/stack-ui";
import { ColorPickerField } from "./components/ColorPickerField";

registerFieldComponent("color", ColorPickerField);

// Use in field configs - just specify the fieldType
fields: {
  favoriteColor: text({
    ui: { fieldType: "color" }  // References the globally registered "color" component
  }),
  themeColor: text({
    ui: { fieldType: "color" }  // Reuse the same component
  })
}
```

**When to use:**

- When you have a reusable field type used across multiple lists
- When building a library of custom field components for your organization
- When you want consistent behavior across similar fields

### 2. Per-Field Component Override (`SlugField`)

The `SlugField` component is used for a specific field, providing auto-generation from the title:

```typescript
fields: {
  slug: text({
    validation: { isRequired: true },
    isIndexed: 'unique',
    ui: {
      component: SlugField, // Override for this specific field
    },
  })
}
```

**When to use:**

- When you need custom behavior for a single field
- When the field has unique requirements not shared by other fields
- When prototyping before creating a reusable component

## Running the Example

```bash
# Install dependencies
pnpm install

# Generate Prisma schema and types
pnpm generate

# Push schema to database
pnpm db:push

# Start development server (runs on port 3001)
pnpm dev
```

Then open [http://localhost:3001/admin](http://localhost:3001/admin)

## Custom Components

### ColorPickerField

- **Location**: `components/ColorPickerField.tsx`
- **Features**:
  - Native HTML5 color picker
  - Hex code text input
  - Read mode with color preview
  - Validation support

### SlugField

- **Location**: `components/SlugField.tsx`
- **Features**:
  - Auto-generation mode from title
  - Manual override capability
  - URL-safe character filtering
  - Visual indicators for auto vs manual mode

## Architecture Benefits

### Extensibility

Adding a new custom field type requires:

1. Create React component matching `FieldComponentProps` interface
2. Either register globally or pass as `ui.component`
3. No changes to core stack code

### Type Safety

```typescript
import type { FieldComponent } from "@opensaas/stack-ui";

// Your component automatically gets proper typing
const MyField: FieldComponent = ({ name, value, onChange, ... }) => {
  // Fully typed props
};
```

### Flexibility

Choose the right approach for your use case:

- **Global registration**: Reusable components, consistent behavior
- **Per-field override**: One-off customizations, rapid prototyping

## Next Steps

Try creating your own custom field components:

1. **Rich Text Editor** - WYSIWYG content editing
2. **Date Range Picker** - Start and end date selection
3. **Tag Input** - Multi-value input with autocomplete
4. **File Upload** - Image/document upload with preview
5. **Geolocation Picker** - Map-based location selection

Each component just needs to:

- Accept standard field props (`name`, `value`, `onChange`, `label`, etc.)
- Handle both `read` and `edit` modes
- Display validation errors
- Support disabled state

## Learn More

- [OpenSaas Documentation](../../README.md)
- [Field Component API](../../packages/ui/src/components/fields/registry.ts)
- [Blog Example](../blog) - Basic usage without custom components
