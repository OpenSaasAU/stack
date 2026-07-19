import { PageHeader, Button } from '@opensaas/stack-ui'

export const Default = () => (
  <div style={{ maxWidth: 640 }}>
    <PageHeader
      title="Posts"
      description="Manage the articles published to your blog."
      actions={<Button>Create post</Button>}
    />
  </div>
)

export const WithBackLink = () => (
  <div style={{ maxWidth: 640 }}>
    <PageHeader
      title="Edit post"
      description="Update the title, body, and publication status of this article."
      backHref="/admin/post"
      backLabel="Back to posts"
      actions={<Button variant="outline">Save changes</Button>}
    />
  </div>
)

export const Gradient = () => (
  <div style={{ maxWidth: 640 }}>
    <PageHeader
      gradient
      title="Dashboard"
      description="An overview of activity across your workspace."
      actions={<Button>New report</Button>}
    />
  </div>
)
