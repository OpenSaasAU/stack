---
'@opensaas/stack-ui': minor
---

Item forms refuse to submit while a field holds input it can't commit, and focus the first invalid field

JSON, decimal and bigInt fields holding text that doesn't parse, and a password that isn't confirmed, now stop the submit with nothing written. A third-party field can do the same with the new `useFieldValidity` hook, and shows its own error:

```tsx
import { useRef, useState } from 'react'
import { FieldError, useFieldValidity } from '@opensaas/stack-ui/fields'

export function HexColorField({ name, value, onChange, mode = 'edit' }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value ?? '')
  const isInvalid = text !== '' && !/^#[0-9a-f]{6}$/i.test(text)

  useFieldValidity(name, mode === 'edit' && isInvalid, inputRef)

  // render the input with ref={inputRef}, and <FieldError> while isInvalid
}
```

The hook is optional, so existing fields need no change.
