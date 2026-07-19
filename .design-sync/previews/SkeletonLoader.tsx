import { SkeletonLoader } from '@opensaas/stack-ui'

const labelStyle = {
  fontSize: 12,
  color: 'var(--color-muted-foreground)',
  marginBottom: 8,
} as const

export const Variants = () => (
  <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
    <div>
      <div style={labelStyle}>text</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 200 }}>
        <SkeletonLoader variant="text" className="w-full" />
        <SkeletonLoader variant="text" className="w-48" />
        <SkeletonLoader variant="text" className="w-32" />
      </div>
    </div>
    <div>
      <div style={labelStyle}>circular</div>
      <SkeletonLoader variant="circular" className="h-12 w-12" />
    </div>
    <div>
      <div style={labelStyle}>rectangular</div>
      <SkeletonLoader variant="rectangular" className="h-16 w-64" />
    </div>
  </div>
)
