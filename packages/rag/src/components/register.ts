'use client'

import { registerCellComponent } from '@opensaas/stack-ui/cells'
import { registerFieldComponent } from '@opensaas/stack-ui/fields'
import { EmbeddingField } from './EmbeddingField.js'
import { EmbeddingCell } from './EmbeddingCell.js'

registerFieldComponent('embedding', EmbeddingField)
registerCellComponent('embedding', EmbeddingCell)
