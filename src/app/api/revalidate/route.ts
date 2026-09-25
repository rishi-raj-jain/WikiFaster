import { titleFromSegments } from '@/lib/links'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

/** Whether the request carries `Authorization: Bearer <REVALIDATE_SECRET>`, compared in constant time. */
function authorized(request: NextRequest): boolean {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Refreshes cached pages, which otherwise stay cached forever:
 * `POST /api/revalidate?title=Albert_Einstein` for one title (also its
 * metadata), `?title=Main_Page` for the homepage (`/` and `/wiki/Main_Page`,
 * with new picks), or with no title for every page. The cached page is still
 * served while the next visit renders it again in the background.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const param = request.nextUrl.searchParams.get('title')
  const tag = param ? titleFromSegments([param]) : 'wiki'
  revalidateTag(tag, 'max')
  return Response.json({ revalidated: tag })
}
