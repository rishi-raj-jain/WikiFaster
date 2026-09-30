import { hasBearer } from '@/lib/bearer'
import { revalidatePath } from 'next/cache'
import { NextRequest } from 'next/server'

/**
 * Next.js tags a cached page with its decoded pathname (`/wiki/AT&T`), so a
 * path spelled as the browser sends it (`/wiki/AT%26T`) is decoded first.
 * One that does not decode (`/wiki/100%`) is used as it is.
 */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** The JSON body: the exact path of one cached page. */
type Body = { path?: unknown }

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

/**
 * Refreshes one cached page, which otherwise stays cached forever. The body is
 * JSON with its exact path, as the browser requests it or decoded:
 * `{ "path": "/wiki/Albert_Einstein" }`, or `{ "path": "/" }` for the homepage
 * (`/wiki/Main_Page` is a separate path). Only that path is refreshed: not
 * other spellings of it (`/wiki/albert_einstein`), and never a route pattern.
 * The page is not served stale: its next visit waits for the new render.
 */
export async function POST(request: NextRequest) {
  if (!hasBearer(request, process.env.REVALIDATE_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Body
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON, like {"path": "/wiki/Albert_Einstein"}')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badRequest('body must be a JSON object')
  if (typeof body.path !== 'string') return badRequest('path must be a string, like "/wiki/Albert_Einstein"')
  const path = decodedPath(body.path)
  if (!path.startsWith('/') || path.length > 1024) return badRequest('path must start with / and be at most 1024 characters')
  // No page's path has brackets (Wikipedia titles cannot contain them), so one that does is a route pattern.
  if (/[[\]]/.test(path)) return badRequest('path must be one page, not a route pattern')
  // Next.js also tags every page with its layouts (`/layout`, `/wiki/layout`), so such a path would refresh them all.
  if (/\/(layout|page|route)\/*$/.test(path)) return badRequest('path must not end in /layout, /page or /route')
  revalidatePath(path)
  return Response.json({ revalidated: path })
}
