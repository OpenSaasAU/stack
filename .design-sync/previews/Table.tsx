import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  Badge,
} from '@opensaas/stack-ui'

const users = [
  { name: 'Ada Lovelace', email: 'ada@opensaas.au', role: 'Owner', status: 'Active' },
  { name: 'Grace Hopper', email: 'grace@opensaas.au', role: 'Admin', status: 'Active' },
  { name: 'Alan Turing', email: 'alan@opensaas.au', role: 'Editor', status: 'Invited' },
  { name: 'Katherine Johnson', email: 'kj@opensaas.au', role: 'Viewer', status: 'Suspended' },
]

const statusVariant = (status: string) =>
  status === 'Active' ? 'success' : status === 'Invited' ? 'warning' : 'destructive'

export const UsersTable = () => (
  <div style={{ maxWidth: 640 }}>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.email}>
            <TableCell style={{ fontWeight: 500 }}>{user.name}</TableCell>
            <TableCell style={{ color: 'var(--color-muted-foreground)' }}>{user.email}</TableCell>
            <TableCell>{user.role}</TableCell>
            <TableCell>
              <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)

export const WithCaption = () => (
  <div style={{ maxWidth: 640 }}>
    <Table>
      <TableCaption>Team members with access to the Marketing workspace.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.slice(0, 3).map((user) => (
          <TableRow key={user.email}>
            <TableCell style={{ fontWeight: 500 }}>{user.name}</TableCell>
            <TableCell>{user.role}</TableCell>
            <TableCell>
              <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
