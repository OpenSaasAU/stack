import { Calendar } from '@opensaas/stack-ui'

const noop = () => {}

export const SingleSelect = () => (
  <div style={{ maxWidth: 320, border: '1px solid var(--color-border)', borderRadius: 8 }}>
    <Calendar mode="single" selected={new Date(2026, 6, 18)} onSelect={noop} />
  </div>
)
