import { TimePicker } from '@opensaas/stack-ui'

const noop = () => {}

export const WithValue = () => (
  <TimePicker value={new Date(2026, 6, 18, 9, 30)} onChange={noop} />
)

export const Disabled = () => (
  <TimePicker value={new Date(2026, 6, 18, 14, 5)} onChange={noop} disabled />
)
