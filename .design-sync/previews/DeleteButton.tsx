import { DeleteButton } from '@opensaas/stack-ui'

const submit = async () => ({ success: true })

export const Default = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <DeleteButton onDelete={submit} itemName="post" buttonLabel="Delete post" />
  </div>
)

export const Outline = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <DeleteButton
      onDelete={submit}
      itemName="post"
      buttonLabel="Remove"
      buttonVariant="outline"
    />
  </div>
)

export const Small = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <DeleteButton onDelete={submit} itemName="comment" buttonLabel="Delete" size="sm" />
  </div>
)
