import { IntegerField } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <IntegerField
      name="readingTime"
      label="Reading time (minutes)"
      value={7}
      onChange={noop}
      helpText="Estimated time to read this post."
    />
  </div>
)

export const Required = () => (
  <div style={{ maxWidth: 360 }}>
    <IntegerField
      name="stock"
      label="Units in stock"
      value={0}
      onChange={noop}
      required
      min={0}
      placeholder="0"
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <IntegerField
      name="price"
      label="Price (cents)"
      value={-50}
      onChange={noop}
      min={0}
      max={100000}
      error="Price must be zero or greater."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <IntegerField name="version" label="Schema version" value={12} onChange={noop} disabled />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <IntegerField name="views" label="Total views" value={4821} onChange={noop} mode="read" />
  </div>
)
