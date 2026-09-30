import { hasBearer } from '@/lib/bearer'
import { revalidatePath } from 'next/cache'
import { NextRequest } from 'next/server'

/** The two paths that render the Main Page, each cached on its own. */
const MAIN_PAGE_PATHS = ['/', '/wiki/Main_Page']

/**
 * Refreshes the Main Page with new picks. Vercel Cron calls it every 12 hours
 * (`vercel.json`) as a GET with `Authorization: Bearer $CRON_SECRET`. Like
 * `/api/revalidate`, the next visit to each path waits for the new render.
 */
export async function GET(request: NextRequest) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  for (const path of MAIN_PAGE_PATHS) revalidatePath(path)
  return Response.json({ revalidated: MAIN_PAGE_PATHS })
}
