import * as React from 'react'
import { Lock } from 'lucide-react'
import { EmptyState } from './EmptyState.js'

export interface UnavailableStateProps {
  title: string
  description: string
  slot: string
}

export function UnavailableState({ title, description, slot }: UnavailableStateProps) {
  return (
    <div data-slot={slot}>
      <EmptyState icon={<Lock className="h-6 w-6" />} title={title} description={description} />
    </div>
  )
}
