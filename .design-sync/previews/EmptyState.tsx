import { EmptyState, Button } from '@opensaas/stack-ui'

export const WithAction = () => (
  <div style={{ maxWidth: 480 }}>
    <EmptyState
      icon={<span aria-hidden="true">📝</span>}
      title="No posts yet"
      description="Your blog is empty. Create your first post to start publishing to your readers."
      actions={<Button>Create post</Button>}
    />
  </div>
)

export const NoAction = () => (
  <div style={{ maxWidth: 480 }}>
    <EmptyState
      icon={<span aria-hidden="true">🔍</span>}
      title="No results found"
      description="No records match your current filters. Try broadening your search criteria."
    />
  </div>
)
