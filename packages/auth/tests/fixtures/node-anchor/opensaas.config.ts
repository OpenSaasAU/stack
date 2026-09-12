import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
  db: { provider: 'postgresql' },
  lists: {},
})
