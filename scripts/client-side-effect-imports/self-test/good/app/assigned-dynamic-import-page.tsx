export default async function Page() {
  const mod = await import('../lib/register-fields')
  return mod ? null : null
}
