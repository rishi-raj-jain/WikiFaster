import { queueUncopiedImages } from '@/lib/image-copies'
import { pageNumber, runSearch } from '@/lib/search'
import { serverTiming } from '@/lib/server-timing'
import { NextRequest } from 'next/server'

/** Every query stops at its statement timeout, so no request needs longer than this. */
export const maxDuration = 300

/** Full-text results with their exact total. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const payload = await runSearch((params.get('q') ?? '').trim().slice(0, 300), pageNumber(params.get('page')), params.get('verbatim') === '1')
  queueUncopiedImages(payload.rows)
  return Response.json(payload, { headers: { 'Server-Timing': serverTiming(payload.ms) } })
}
