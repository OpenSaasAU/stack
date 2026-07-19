import { Badge } from '@opensaas/stack-ui'

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Badge>Active</Badge>
    <Badge variant="secondary">Draft</Badge>
    <Badge variant="success">Published</Badge>
    <Badge variant="warning">Pending</Badge>
    <Badge variant="destructive">Failed</Badge>
    <Badge variant="outline">Archived</Badge>
  </div>
)
