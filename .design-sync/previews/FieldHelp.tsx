import { FieldRoot, FieldLabel, FieldHelp, Input } from '@opensaas/stack-ui'

export const BelowInput = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="email">Email address</FieldLabel>
      <Input id="email" defaultValue="ada@example.com" />
      <FieldHelp>We'll never share your email with anyone else.</FieldHelp>
    </FieldRoot>
  </div>
)

export const WithRequiredLabel = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="slug" required>
        Slug
      </FieldLabel>
      <Input id="slug" defaultValue="my-first-post" />
      <FieldHelp>URL-friendly identifier — lowercase letters, numbers and hyphens only.</FieldHelp>
    </FieldRoot>
  </div>
)
