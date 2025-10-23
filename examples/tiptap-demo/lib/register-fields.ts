'use client'

import { registerFieldComponent } from '@opensaas/ui'
import { TiptapField } from '@opensaas/tiptap'

// Register custom field components
// This must run on the client side before any components try to render
registerFieldComponent('richText', TiptapField)
