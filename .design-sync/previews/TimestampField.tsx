import { TimestampField } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <TimestampField
      name="publishedAt"
      label="Publish date"
      value="2026-03-14T09:30:00.000Z"
      onChange={noop}
      helpText="When this post should go live."
    />
  </div>
)

export const Required = () => (
  <div style={{ maxWidth: 360 }}>
    <TimestampField
      name="startsAt"
      label="Event starts at"
      value="2026-06-01T18:00:00.000Z"
      onChange={noop}
      required
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <TimestampField
      name="expiresAt"
      label="Expires at"
      value="2026-01-01T00:00:00.000Z"
      onChange={noop}
      error="Expiry date must be in the future."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <TimestampField
      name="createdAt"
      label="Created at"
      value="2025-11-02T14:12:00.000Z"
      onChange={noop}
      disabled
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <TimestampField
      name="publishedAt"
      label="Published"
      value="2026-03-14T09:30:00.000Z"
      onChange={noop}
      mode="read"
    />
  </div>
)
