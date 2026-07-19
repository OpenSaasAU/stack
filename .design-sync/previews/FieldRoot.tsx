import { FieldRoot, FieldLabel, FieldHelp, FieldReadValue, Input } from '@opensaas/stack-ui'

export const EditField = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="workspace">Workspace name</FieldLabel>
      <Input id="workspace" defaultValue="Acme Analytics" placeholder="Enter a workspace name" />
      <FieldHelp>Shown to every member in the workspace switcher.</FieldHelp>
    </FieldRoot>
  </div>
)

export const ReadField = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot mode="read">
      <FieldLabel muted>Workspace name</FieldLabel>
      <FieldReadValue>Acme Analytics</FieldReadValue>
    </FieldRoot>
  </div>
)
