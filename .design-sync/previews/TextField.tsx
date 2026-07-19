import { TextField } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 360 }}>
    <TextField
      name="email"
      label="Email address"
      value="ada@example.com"
      onChange={noop}
      placeholder="you@example.com"
      helpText="We'll never share your email."
    />
  </div>
)

export const Required = () => (
  <div style={{ maxWidth: 360 }}>
    <TextField
      name="title"
      label="Post title"
      value=""
      onChange={noop}
      required
      placeholder="Enter a descriptive title"
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <TextField
      name="slug"
      label="Slug"
      value="My First Post!"
      onChange={noop}
      error="Slug can only contain lowercase letters, numbers and hyphens."
    />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 360 }}>
    <TextField name="id" label="Identifier" value="usr_8f2a1c" onChange={noop} disabled />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 360 }}>
    <TextField
      name="bio"
      label="Bio"
      value="Building admin tools that stay out of the way."
      onChange={noop}
      mode="read"
    />
  </div>
)
