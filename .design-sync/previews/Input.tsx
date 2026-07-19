import { Input, Label } from '@opensaas/stack-ui'

export const WithValueAndPlaceholder = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
    <Input defaultValue="ada@example.com" />
    <Input placeholder="Search posts, users and settings…" />
  </div>
)

export const Labelled = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
    <Label htmlFor="workspace">Workspace name</Label>
    <Input id="workspace" defaultValue="Acme Analytics" placeholder="Enter a workspace name" />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <Input defaultValue="usr_8f2a1c9d" disabled />
  </div>
)
