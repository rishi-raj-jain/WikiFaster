import type { ImageRef } from '@/lib/links'
import { queueImageCopies } from '@/lib/queries'
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
