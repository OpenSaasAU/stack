import { Textarea, Label } from '@opensaas/stack-ui'

export const WithValue = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 }}>
    <Label htmlFor="bio">Bio</Label>
    <Textarea
      id="bio"
      rows={4}
      defaultValue={
        'Product engineer building admin tools that stay out of the way.\n\nPreviously led platform teams at two SaaS startups.'
      }
    />
  </div>
)

export const Placeholder = () => (
  <div style={{ maxWidth: 420 }}>
    <Textarea rows={4} placeholder="Write release notes for this deployment…" />
  </div>
)

export const Disabled = () => (
  <div style={{ maxWidth: 420 }}>
    <Textarea
      rows={4}
      disabled
      defaultValue="This changelog entry has been published and can no longer be edited."
    />
  </div>
)
