import { DateTimePicker } from '@opensaas/stack-ui'

const noop = () => {}

export const WithValue = () => (
  <div style={{ maxWidth: 320 }}>
    <DateTimePicker value={new Date(2026, 6, 18, 9, 30)} onChange={noop} />
  </div>
)

export const Placeholder = () => (
  <div style={{ maxWidth: 320 }}>
    <DateTimePicker onChange={noop} placeholder="Schedule publish time" />
  </div>
)
