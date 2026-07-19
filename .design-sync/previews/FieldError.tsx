import { FieldRoot, FieldLabel, FieldError, Input } from '@opensaas/stack-ui'

export const InvalidSlug = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="slug">Slug</FieldLabel>
      <Input id="slug" defaultValue="My First Post!" aria-invalid />
      <FieldError>Slug can only contain lowercase letters, numbers and hyphens.</FieldError>
    </FieldRoot>
  </div>
)

export const RequiredMissing = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="title" required>
        Post title
      </FieldLabel>
      <Input id="title" defaultValue="" placeholder="Enter a descriptive title" aria-invalid />
      <FieldError>Title is required.</FieldError>
    </FieldRoot>
  </div>
)
