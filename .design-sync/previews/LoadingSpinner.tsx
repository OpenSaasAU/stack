import { LoadingSpinner } from '@opensaas/stack-ui'

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
    <LoadingSpinner size="sm" />
    <LoadingSpinner size="md" />
    <LoadingSpinner size="lg" />
  </div>
)
