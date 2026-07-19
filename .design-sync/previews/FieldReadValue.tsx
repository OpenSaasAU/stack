import { FieldRoot, FieldLabel, FieldReadValue } from '@opensaas/stack-ui'

export const ScalarValue = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot mode="read">
      <FieldLabel muted>Email address</FieldLabel>
      <FieldReadValue>ada@example.com</FieldReadValue>
    </FieldRoot>
  </div>
)

export const LongText = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot mode="read">
      <FieldLabel muted>Bio</FieldLabel>
      <FieldReadValue>Building admin tools that stay out of the way.</FieldReadValue>
    </FieldRoot>
  </div>
)

export const Stacked = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 360 }}>
    <FieldRoot mode="read">
      <FieldLabel muted>Status</FieldLabel>
      <FieldReadValue>Published</FieldReadValue>
    </FieldRoot>
    <FieldRoot mode="read">
      <FieldLabel muted>Created</FieldLabel>
      <FieldReadValue>18 July 2026, 9:42 AM</FieldReadValue>
    </FieldRoot>
  </div>
)
