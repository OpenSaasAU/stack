import { Button } from '@opensaas/stack-ui'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button>Save changes</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="destructive">Delete</Button>
    <Button variant="outline">Export</Button>
    <Button variant="ghost">Dismiss</Button>
    <Button variant="link">Learn more</Button>
  </div>
)

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
  </div>
)

export const States = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button>Enabled</Button>
    <Button disabled>Disabled</Button>
  </div>
)
