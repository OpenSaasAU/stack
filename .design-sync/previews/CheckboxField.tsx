import { CheckboxField } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <CheckboxField
      name="featured"
      label="Feature this post on the homepage"
      value={true}
      onChange={noop}
      helpText="Featured posts appear in the hero carousel."
    />
  </div>
)

export const Unchecked = () => (
  <div style={{ maxWidth: 360 }}>
    <CheckboxField
      name="sendNewsletter"
      label="Send to newsletter subscribers"
      value={false}
      onChange={noop}
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <CheckboxField
      name="acceptTerms"
      label="I accept the terms of service"
      value={false}
      onChange={noop}
      error="You must accept the terms to continue."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <CheckboxField
      name="verified"
      label="Email verified"
      value={true}
      onChange={noop}
      disabled
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <CheckboxField name="featured" label="Featured post" value={true} onChange={noop} mode="read" />
  </div>
)
