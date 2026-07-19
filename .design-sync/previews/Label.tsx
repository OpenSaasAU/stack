import { Label, Input, Checkbox } from '@opensaas/stack-ui'

export const WithInput = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
    <Label htmlFor="email">Email address</Label>
    <Input id="email" type="email" defaultValue="ada@example.com" placeholder="you@example.com" />
  </div>
)

export const WithCheckbox = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <Checkbox id="marketing" defaultChecked />
    <Label htmlFor="marketing">Subscribe to the monthly newsletter</Label>
  </div>
)
