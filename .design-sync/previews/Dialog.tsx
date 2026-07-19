import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Label,
  Input,
} from '@opensaas/stack-ui'

const noop = () => {}

export const Confirmation = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete project</DialogTitle>
        <DialogDescription>
          This permanently removes the project and all of its environments. This action cannot be
          undone.
        </DialogDescription>
      </DialogHeader>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-muted-foreground)' }}>
        Members will lose access immediately and any running deployments will be stopped.
      </div>
      <DialogFooter style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline">Cancel</Button>
        <Button variant="destructive">Delete project</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

export const FormDialog = () => (
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite teammate</DialogTitle>
        <DialogDescription>Send an invitation to join this workspace.</DialogDescription>
      </DialogHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label htmlFor="invite-email">Email address</Label>
          <Input id="invite-email" type="email" value="alex@acme.com" onChange={noop} />
        </div>
      </div>
      <DialogFooter style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline">Cancel</Button>
        <Button>Send invite</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)
