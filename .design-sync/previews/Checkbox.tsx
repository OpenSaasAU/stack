import { Checkbox, Label } from '@opensaas/stack-ui'

export const WithLabels = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="terms" defaultChecked />
      <Label htmlFor="terms">I accept the terms and conditions</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="newsletter" />
      <Label htmlFor="newsletter">Send me product updates by email</Label>
    </div>
  </div>
)

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="checked" defaultChecked />
      <Label htmlFor="checked">Checked</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="unchecked" />
      <Label htmlFor="unchecked">Unchecked</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="disabled-on" defaultChecked disabled />
      <Label htmlFor="disabled-on">Disabled (locked on)</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="disabled-off" disabled />
      <Label htmlFor="disabled-off">Disabled (unavailable)</Label>
    </div>
  </div>
)
