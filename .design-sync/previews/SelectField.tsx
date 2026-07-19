import { SelectField } from '@opensaas/stack-ui'

const noop = () => {}

const statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Archived', value: 'archived' },
]

const roleOptions = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Viewer', value: 'viewer' },
]

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <SelectField
      name="status"
      label="Post status"
      value="published"
      onChange={noop}
      options={statusOptions}
      helpText="Controls whether the post is visible to readers."
    />
  </div>
)

export const Required = () => (
  <div style={{ maxWidth: 360 }}>
    <SelectField
      name="role"
      label="User role"
      value=""
      onChange={noop}
      required
      options={roleOptions}
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <SelectField
      name="status"
      label="Post status"
      value=""
      onChange={noop}
      options={statusOptions}
      error="Please choose a status before saving."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <SelectField
      name="role"
      label="User role"
      value="admin"
      onChange={noop}
      options={roleOptions}
      disabled
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <SelectField
      name="status"
      label="Post status"
      value="archived"
      onChange={noop}
      options={statusOptions}
      mode="read"
    />
  </div>
)
