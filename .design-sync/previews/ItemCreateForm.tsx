import { ItemCreateForm } from '@opensaas/stack-ui'

const submit = async () => ({ success: true })

const postFields = {
  title: {
    type: 'text',
    label: 'Title',
    validation: { isRequired: true },
  },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
      { label: 'Archived', value: 'archived' },
    ],
  },
  publishedAt: {
    type: 'timestamp',
    label: 'Published at',
  },
}

export const Default = () => (
  <div style={{ maxWidth: 480 }}>
    <ItemCreateForm fields={postFields} onSubmit={submit} submitLabel="Create post" />
  </div>
)

export const WithCancel = () => (
  <div style={{ maxWidth: 480 }}>
    <ItemCreateForm
      fields={postFields}
      onSubmit={submit}
      onCancel={() => {}}
      submitLabel="Create post"
      cancelLabel="Discard"
    />
  </div>
)
