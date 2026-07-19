import { FieldRoot, FieldLabel, FieldWarning, Input } from '@opensaas/stack-ui'

export const InProgressJson = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="metadata">Metadata</FieldLabel>
      <Input id="metadata" defaultValue='{ "featured": true,' />
      <FieldWarning>Incomplete JSON — changes won't be saved until this parses.</FieldWarning>
    </FieldRoot>
  </div>
)

export const DeprecatedValue = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRoot>
      <FieldLabel htmlFor="region">Region</FieldLabel>
      <Input id="region" defaultValue="us-west-1" />
      <FieldWarning>This region is being retired — migrate to us-west-2 before December.</FieldWarning>
    </FieldRoot>
  </div>
)
