---
'@opensaas/stack-cli': minor
---

Add BaseContext type for shared services between hooks and server actions

The type generator now exports a `BaseContext` type that contains only the core context properties (`db`, `session`, `storage`, `plugins`, `_isSudo`). This allows services to accept a base context type that works with both:

- **Field hooks** (which receive `AccessContext`)
- **Server actions** (which receive full `Context`)

Previously, services had to choose between accepting `Context` (incompatible with hooks) or using type assertions. Now you can write services that work in both contexts:

```typescript
// In your generated .opensaas/types.ts, you'll now have both:
export type BaseContext<TSession extends OpensaasSession = OpensaasSession> = {
  db: CustomDB
  session: TSession
  // ... other base properties
}

export type Context<TSession extends OpensaasSession = OpensaasSession> = BaseContext<TSession> & {
  serverAction: (props: ServerActionProps) => Promise<unknown>
  sudo: () => Context<TSession>
}
```

**Usage example:**

```typescript
// Service that works with both hooks and server actions
export class ScheduleService {
  private context: BaseContext // ✅ Accepts BaseContext instead of Context

  constructor(context: BaseContext) {
    this.context = context
  }

  async checkConflicts(userId: string) {
    // Only uses db and session - works everywhere
    return this.context.db.schedule.findMany({
      where: { userId },
    })
  }
}

// Factory function
export function createScheduleService(context: BaseContext): ScheduleService {
  return new ScheduleService(context)
}

// ✅ Works in field hooks
fields: {
  schedule: relationship({
    ref: 'Schedule',
    hooks: {
      validateInput: async ({ context, addValidationError }) => {
        const service = createScheduleService(context) // No type error!
        const hasConflict = await service.checkConflicts(userId)
        if (hasConflict) {
          addValidationError('Schedule conflict detected')
        }
      },
    },
  })
}

// ✅ Also works in server actions
export async function checkSchedule(context: Context, userId: string) {
  const service = createScheduleService(context) // Also works!
  return service.checkConflicts(userId)
}
```

This resolves the type incompatibility issue where services needed to use type assertions or duplicate code to work in both hooks and server actions.
