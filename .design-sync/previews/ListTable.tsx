import { ListTable } from '@opensaas/stack-ui'

const posts: Record<string, unknown>[] = [
  { id: '1', title: 'Launching the new dashboard', author: 'Ada Lovelace', status: 'Published', views: 1240 },
  { id: '2', title: 'Access control, explained', author: 'Grace Hopper', status: 'Published', views: 862 },
  { id: '3', title: 'Draft: migrating from Keystone', author: 'Alan Turing', status: 'Draft', views: 0 },
  { id: '4', title: 'Field-level hooks in practice', author: 'Katherine Johnson', status: 'Review', views: 315 },
]

const fieldTypes = {
  title: 'text',
  author: 'text',
  status: 'text',
  views: 'integer',
}

export const Populated = () => (
  <div style={{ maxWidth: 720 }}>
    <ListTable
      items={posts}
      fieldTypes={fieldTypes}
      columns={['title', 'author', 'status', 'views']}
    />
  </div>
)

export const Empty = () => (
  <div style={{ maxWidth: 720 }}>
    <ListTable
      items={[]}
      fieldTypes={fieldTypes}
      columns={['title', 'author', 'status', 'views']}
      emptyMessage="No posts yet — create your first post to get started."
    />
  </div>
)
