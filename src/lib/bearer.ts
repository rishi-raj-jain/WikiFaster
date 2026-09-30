import { timingSafeEqual } from 'node:crypto'

/** Whether the request carries `Authorization: Bearer <secret>`, compared in constant time. No secret set, no access. */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
