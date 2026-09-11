'use client'

import { registerFieldComponent, registerCellComponent } from '@opensaas/stack-ui'
import { EmbeddingField } from './EmbeddingField.js'
import { EmbeddingCell } from './EmbeddingCell.js'

registerFieldComponent('embedding', EmbeddingField)
registerCellComponent('embedding', EmbeddingCell)
