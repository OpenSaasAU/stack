'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { JsonEditor } from '../components/JsonEditor'
import { TaxonomyField } from '../components/TaxonomyField'

// Register custom JsonEditor component
registerFieldComponent('jsonEditor', JsonEditor)

// Register custom TaxonomyField component
registerFieldComponent('taxonomy', TaxonomyField)
