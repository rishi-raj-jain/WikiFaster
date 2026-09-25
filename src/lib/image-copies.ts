import { db } from '@/db'
import { imageQueue } from '@/db/schema'
import type { ImageRef } from '@/lib/links'
import { sql } from 'drizzle-orm'
import { after } from 'next/server'

/**
 * Once the response is sent, queues the shown articles whose lead image still
 * loads from Wikimedia, so the images function copies it into the bucket and
 * later views load it from Neon. A failed insert only delays the copy.
 */
export function queueUncopiedImages(items: { id: number; image: ImageRef | null }[]) {
  const ids = items.filter((item) => item.image && !item.image.stored).map((item) => item.id)
  if (ids.length > 0) after(() => queueImageCopies(ids).catch(() => {}))
}

/**
 * Queues articles for the images function (`functions/images.ts`). Viewed
 * articles go first (priority 0), so one already waiting in the backfill moves
 * to the front. Not timed or counted: it runs after the response.
 */
async function queueImageCopies(ids: number[]): Promise<void> {
  await db
    .insert(imageQueue)
    .values(ids.map((id) => ({ id })))
    .onConflictDoUpdate({ target: imageQueue.id, set: { priority: 0 }, setWhere: sql`${imageQueue.priority} > 0` })
}
