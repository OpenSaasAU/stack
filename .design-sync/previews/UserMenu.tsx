import { UserMenu } from '@opensaas/stack-ui'

const asyncNoop = async () => {}

export const Default = () => (
  <div style={{ width: 280 }}>
    <UserMenu userName="Ada Lovelace" userEmail="ada@example.com" onSignOut={asyncNoop} />
  </div>
)
