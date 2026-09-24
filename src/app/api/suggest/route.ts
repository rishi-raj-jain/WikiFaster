import { measureDb } from '@/db'
import { suggest } from '@/lib/queries'
import { serverTiming } from '@/lib/server-timing'
import { firstSentence } from '@/lib/wikitext'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Search-box suggestions (title plus a one-line description from the lead) and what they cost in Postgres. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 200)
  const { value: rows, dbMs, totalMs } = await measureDb(() => suggest(q).catch(() => []))
  const suggestions = rows.map((row) => ({ title: row.title, description: firstSentence(row.description, 90) }))
  return Response.json({ suggestions, dbMs, ms: totalMs }, { headers: { 'Server-Timing': serverTiming(dbMs, totalMs) } })
}
