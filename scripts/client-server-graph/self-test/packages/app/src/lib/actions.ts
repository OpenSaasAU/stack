'use server'

import { readFileSync } from 'node:fs'

export async function readConfig() {
  return readFileSync('x', 'utf8')
}
