# Security Policy

## Reporting a Vulnerability

We take the security of OpenSaas Stack seriously. If you discover a security vulnerability, please follow these steps:

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Email security details to: [Create an issue at https://github.com/your-org/opensaas-stack/security/advisories/new]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to understand and address the issue.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Best Practices

### 1. Access Control

OpenSaas Stack's primary security feature is its automatic access control system. **Always** use the context wrapper instead of direct Prisma access:

```typescript
// ✅ Good - Access control enforced
const context = getContext({ userId })
const posts = await context.db.post.findMany()

// ❌ Bad - Bypasses access control
const posts = await prisma.post.findMany()
```

### 2. Authentication

When using `@opensaas/stack-auth`:

- **Never store plaintext passwords** - Better-auth handles bcrypt hashing automatically
- **Use environment variables** for sensitive configuration:
  ```bash
  BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
  DATABASE_URL=<your-database-connection-string>
  ```
- **Enable OAuth providers carefully** - Each provider requires proper callback URL configuration
- **Validate session data** - Don't trust session fields without verification in access control

### 3. Environment Variables

- **Never commit** `.env` files to version control
- Use `.env.example` files to document required variables
- Rotate secrets regularly (BETTER_AUTH_SECRET, OAuth client secrets, etc.)

### 4. Database Security

- **Use connection pooling** in production (e.g., Prisma Data Proxy, PgBouncer)
- **Limit database user permissions** - Only grant what's necessary
- **Use read replicas** for query-heavy operations when possible
- **Enable SSL/TLS** for database connections in production

### 5. Field-Level Access Control

The stack supports field-level access control. Use it for sensitive data:

```typescript
fields: {
  internalNotes: text({
    access: {
      read: ({ session }) => session?.role === 'admin',
      create: ({ session }) => session?.role === 'admin',
      update: ({ session }) => session?.role === 'admin',
    },
  })
}
```

### 6. Input Validation

Always validate user input using the built-in validation system:

```typescript
fields: {
  email: text({
    validation: {
      isRequired: true,
      match: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email format' },
    },
  })
}
```

For complex validation, use `validateInput` hooks:

```typescript
hooks: {
  validateInput: async ({ resolvedData, context }) => {
    if (resolvedData.url && !isValidUrl(resolvedData.url)) {
      throw new ValidationError([{ path: 'url', message: 'Invalid URL format' }])
    }
  }
}
```

### 7. Rate Limiting

The stack does not include built-in rate limiting. Implement rate limiting middleware in your Next.js app:

```typescript
// middleware.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
})

export async function middleware(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? 'anonymous'
  const { success } = await ratelimit.limit(ip)
  if (!success) return new Response('Rate limit exceeded', { status: 429 })
}
```

### 8. CSRF Protection

Next.js Server Actions include built-in CSRF protection. If using custom API routes, implement CSRF tokens:

```typescript
// Use packages like 'csrf' or 'next-csrf'
import { createCsrfProtect } from '@edge-csrf/nextjs'

const csrfProtect = createCsrfProtect({
  cookie: { secure: process.env.NODE_ENV === 'production' },
})
```

### 9. Content Security Policy

Configure CSP headers in `next.config.js`:

```javascript
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline';",
          },
        ],
      },
    ]
  },
}
```

### 10. Dependency Security

- Run `pnpm audit` regularly to check for vulnerabilities
- Keep dependencies up to date (especially `@prisma/client`, `better-auth`, `next`)
- Review security advisories for critical packages

## Known Limitations

### 1. Silent Failures

Access-controlled operations return `null` or `[]` on denial rather than throwing errors. This prevents information leakage but requires explicit null checks:

```typescript
const post = await context.db.post.findUnique({ where: { id } })
if (!post) {
  // Could be: doesn't exist OR access denied
  return { error: 'Not found or access denied' }
}
```

### 2. No Built-in Audit Logging

The stack does not automatically log access control denials or sensitive operations. Implement audit logging using hooks:

```typescript
hooks: {
  afterOperation: async ({ operation, item, context }) => {
    await auditLog.create({
      userId: context.session?.userId,
      operation,
      listKey: 'Post',
      itemId: item.id,
      timestamp: new Date(),
    })
  },
}
```

### 3. Context Required for Security

Direct Prisma access bypasses all access control. Ensure all database operations use the context wrapper. Consider restricting Prisma client exports in production code.

### 4. Session Management

When using `@opensaas/stack-auth`:

- Sessions are stored in the database (not JWT-based)
- Session cleanup is automatic via Better-auth
- Expired sessions may remain in database until cleanup runs
- Consider implementing custom session expiry logic for high-security apps

### 5. File Upload Security

The stack does not include file upload handling. When implementing file uploads:

- Validate file types (use MIME type detection, not just extensions)
- Scan uploads for malware
- Store files outside web root or use signed URLs
- Implement size limits
- Use content-addressable storage (hash-based filenames)

### 6. SQL Injection

Prisma Client provides automatic SQL injection protection. **Never** use raw SQL queries with user input unless properly parameterized:

```typescript
// ✅ Safe - Parameterized
await prisma.$queryRaw`SELECT * FROM Post WHERE id = ${postId}`

// ❌ Unsafe - String concatenation
await prisma.$queryRawUnsafe(`SELECT * FROM Post WHERE id = ${postId}`)
```

## Security Checklist for Production

Before deploying to production:

- [ ] All access control functions return proper boolean/filter values
- [ ] Sensitive fields have field-level access control
- [ ] Environment variables are set and secured
- [ ] Database connections use SSL/TLS
- [ ] Rate limiting middleware is implemented
- [ ] CSRF protection is enabled (built-in for Server Actions)
- [ ] Content Security Policy headers are configured
- [ ] Dependencies have been audited (`pnpm audit`)
- [ ] Authentication secrets are rotated from defaults
- [ ] OAuth callback URLs are configured correctly
- [ ] Error messages don't leak sensitive information
- [ ] Logging captures security events (access denials, auth failures)

## Reporting False Positives

If you believe you've found a security issue that is actually expected behavior, please still report it. We'll clarify the behavior in documentation if needed.

## Security Updates

Security patches will be released as soon as possible after verification. Subscribe to GitHub releases and security advisories to stay informed.

## Additional Resources

- [Better-auth Security Documentation](https://better-auth.com/docs/security)
- [Prisma Security Best Practices](https://www.prisma.io/docs/guides/database/deployment)
- [Next.js Security Best Practices](https://nextjs.org/docs/app/building-your-application/configuring/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
