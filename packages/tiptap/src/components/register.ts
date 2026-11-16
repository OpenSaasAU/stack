'use client'

import { registerCellComponent } from '@opensaas/stack-ui/cells'
import { registerFieldComponent } from '@opensaas/stack-ui/fields'
import { TiptapField } from './TiptapField.js'
import { TiptapCell } from './TiptapCell.js'

registerFieldComponent('richText', TiptapField)
registerCellComponent('richText', TiptapCell)
