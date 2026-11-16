'use client'

import { readFileSync } from 'node:fs'

export const read = () => readFileSync('x', 'utf8')
