'use client'

import { registerFieldComponent, registerCellComponent } from '@opensaas/stack-ui'
import { TiptapField } from './TiptapField.js'
import { TiptapCell } from './TiptapCell.js'

registerFieldComponent('richText', TiptapField)
registerCellComponent('richText', TiptapCell)
