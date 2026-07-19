import { FieldRoot, FieldLabel, Input } from '@opensaas/stack-ui'

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="email">Email address</FieldLabel>
      <Input id="email" defaultValue="ada@example.com" />
    </FieldRoot>
  </div>
)

export const Required = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="title" required>
        Post title
      </FieldLabel>
      <Input id="title" placeholder="Enter a descriptive title" />
    </FieldRoot>
  </div>
)

export const Muted = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot mode="read">
      <FieldLabel muted>Role</FieldLabel>
      <Input defaultValue="Administrator" disabled />
    </FieldRoot>
  </div>
)
