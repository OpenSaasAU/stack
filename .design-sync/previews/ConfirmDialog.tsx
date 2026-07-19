import { ConfirmDialog } from '@opensaas/stack-ui'

const noop = () => {}

export const Danger = () => (
  <ConfirmDialog
    isOpen={true}
    variant="danger"
    title="Delete post"
    message="This will permanently delete “Getting started with OpenSaaS” and cannot be undone."
    confirmLabel="Delete post"
    cancelLabel="Cancel"
    onConfirm={noop}
    onCancel={noop}
  />
)

export const Warning = () => (
  <ConfirmDialog
    isOpen={true}
    variant="warning"
    title="Discard changes?"
    message="You have unsaved edits on this post. Leaving now will discard them."
    confirmLabel="Discard changes"
    cancelLabel="Keep editing"
    onConfirm={noop}
    onCancel={noop}
  />
)
