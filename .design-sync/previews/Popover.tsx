import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Button,
  Label,
  Input,
} from '@opensaas/stack-ui'

const noop = () => {}

export const Settings = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="outline">Dimensions</Button>
    </PopoverTrigger>
    <PopoverContent>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Dimensions</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
            Set the size for the container.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Label htmlFor="pop-width" style={{ width: 72 }}>
            Width
          </Label>
          <Input id="pop-width" value="480px" onChange={noop} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Label htmlFor="pop-height" style={{ width: 72 }}>
            Height
          </Label>
          <Input id="pop-height" value="320px" onChange={noop} />
        </div>
      </div>
    </PopoverContent>
  </Popover>
)

export const AccountMenu = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="outline">Account</Button>
    </PopoverTrigger>
    <PopoverContent>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600 }}>Jordan Lee</p>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
          jordan@acme.com
        </p>
        <Button variant="ghost" style={{ justifyContent: 'flex-start' }}>
          Profile settings
        </Button>
        <Button variant="ghost" style={{ justifyContent: 'flex-start' }}>
          Billing
        </Button>
        <Button variant="ghost" style={{ justifyContent: 'flex-start' }}>
          Sign out
        </Button>
      </div>
    </PopoverContent>
  </Popover>
)
