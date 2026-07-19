import { ItemEditForm } from '@opensaas/stack-ui'

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

const post = {
  title: 'Launching the new dashboard',
  status: 'published',
  publishedAt: '2026-02-14T09:30:00Z',
}

export const Default = () => (
  <div style={{ maxWidth: 480 }}>
    <ItemEditForm
      fields={postFields}
      initialData={post}
      onSubmit={submit}
      submitLabel="Save changes"
    />
  </div>
)

export const WithCancel = () => (
  <div style={{ maxWidth: 480 }}>
    <ItemEditForm
      fields={postFields}
      initialData={post}
      onSubmit={submit}
      onCancel={() => {}}
      submitLabel="Save changes"
      cancelLabel="Cancel"
    />
  </div>
)
