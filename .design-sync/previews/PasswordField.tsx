import { PasswordField } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <PasswordField
      name="password"
      label="Password"
      value=""
      onChange={noop}
      placeholder="Enter a new password"
      helpText="Use at least 12 characters with a mix of letters and numbers."
    />
  </div>
)

export const AlreadySet = () => (
  <div style={{ maxWidth: 360 }}>
    <PasswordField
      name="password"
      label="Password"
      value={{ isSet: true }}
      onChange={noop}
      helpText="A password is already set for this account."
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <PasswordField
      name="password"
      label="Password"
      value=""
      onChange={noop}
      required
      error="Password must be at least 12 characters long."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <PasswordField
      name="password"
      label="Password"
      value=""
      onChange={noop}
      placeholder="Managed by your SSO provider"
      disabled
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <PasswordField
      name="password"
      label="Password"
      value={{ isSet: true }}
      onChange={noop}
      mode="read"
    />
  </div>
)
