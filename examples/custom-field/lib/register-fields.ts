'use client'

import { registerFieldComponent } from '@opensaas/stack-ui'
import { ColorPickerField } from '../components/ColorPickerField'
import { SlugField } from '../components/SlugField'

/**
 * Register custom field components
 * This must run on the client side before any components try to render
 */
registerFieldComponent('color', ColorPickerField)
registerFieldComponent('slug', SlugField)
