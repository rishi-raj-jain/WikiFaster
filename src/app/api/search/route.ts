import { serverTiming } from '@/lib/server-timing'
import { pageNumber, runSearch } from '@/lib/search'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Full-text results with their exact total. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const payload = await runSearch((params.get('q') ?? '').trim().slice(0, 300), pageNumber(params.get('page')), params.get('verbatim') === '1')
  return Response.json(payload, { headers: { 'Server-Timing': serverTiming(payload.dbMs, payload.ms) } })
}
