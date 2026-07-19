import { FieldRenderer } from '@opensaas/stack-ui'

const noop = () => {}

export const TextConfig = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRenderer
      fieldName="title"
      fieldConfig={{
        type: 'text',
        label: 'Post title',
        validation: { isRequired: true },
        ui: { description: 'Shown as the headline on the post page.' },
      }}
      value="Designing admin tools that stay out of the way"
      onChange={noop}
    />
  </div>
)

export const SelectConfig = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRenderer
      fieldName="status"
      fieldConfig={{
        type: 'select',
        label: 'Status',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
          { label: 'Archived', value: 'archived' },
        ],
      }}
      value="published"
      onChange={noop}
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRenderer
      fieldName="slug"
      fieldConfig={{ type: 'text', label: 'Slug' }}
      value="My First Post!"
      onChange={noop}
      error="Slug can only contain lowercase letters, numbers and hyphens."
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <FieldRenderer
      fieldName="email"
      fieldConfig={{ type: 'text', label: 'Email address' }}
      value="ada@example.com"
      onChange={noop}
      mode="read"
    />
  </div>
)
