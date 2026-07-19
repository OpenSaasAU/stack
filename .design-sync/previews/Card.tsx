import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Badge,
} from '@opensaas/stack-ui'

export const WithHeaderAndFooter = () => (
  <Card style={{ maxWidth: 380 }}>
    <CardHeader>
      <CardTitle>Project settings</CardTitle>
      <CardDescription>Manage how your workspace behaves and who can access it.</CardDescription>
    </CardHeader>
    <CardContent>
      <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
        Changes apply immediately across every environment. Members are notified by email whenever
        their access level changes.
      </p>
    </CardContent>
    <CardFooter style={{ display: 'flex', gap: 8 }}>
      <Button>Save changes</Button>
      <Button variant="outline">Cancel</Button>
    </CardFooter>
  </Card>
)

export const StatCard = () => (
  <Card style={{ maxWidth: 260 }}>
    <CardHeader>
      <CardDescription>Monthly revenue</CardDescription>
      <CardTitle>$48,120</CardTitle>
    </CardHeader>
    <CardContent style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge variant="success">+12.5%</Badge>
      <span style={{ fontSize: 13, color: 'var(--color-muted-foreground)' }}>vs last month</span>
    </CardContent>
  </Card>
)
