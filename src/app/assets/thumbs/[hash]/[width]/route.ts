import { ASSETS_URL, IMAGE_WIDTH } from '@/lib/links'

/** Keys are `thumbs/<sha1 of the file name>/<width>` (see functions/images.ts). */
const HASH = /^[0-9a-f]{40}$/

/**
 * A lead image's copy from Neon Object Storage, served from this site so the
 * CDN caches it in every region like the pages, and the browser fetches it on
 * the connection it already has open. Only the copies' own keys are accepted,
 * so this cannot fetch anything else. Copies never change, so browsers and
 * the CDN keep them for a year.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ hash: string; width: string }> }) {
  const { hash, width } = await params
  if (!ASSETS_URL || !HASH.test(hash) || width !== String(IMAGE_WIDTH)) return new Response('Not found', { status: 404 })
  const res = await fetch(`${ASSETS_URL}/thumbs/${hash}/${width}`)
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.startsWith('image/')) return new Response('Not found', { status: res.status === 404 ? 404 : 502 })
  return new Response(res.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The CDN's own copy, which Vercel does not pass on to the browser.
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
