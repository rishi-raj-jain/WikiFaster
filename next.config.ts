import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pages cache their whole render with `use cache`. Partial prefetching lets an article's page, first
  // rendered on a visit, be served from the cache for later ones (ISR).
  cacheComponents: true,
  partialPrefetching: true,
  // Pages stay cached on Vercel until /api/revalidate (or the Main Page's cron job) refreshes them, never
  // on a timer. They are prerendered (ISR), so Vercel keeps one copy for every instance and serves it
  // from the CDN, and browsers get it with `max-age=0`, so they always ask again. `stale: 30` is the
  // least that allows prerendering: `use cache` below that only keeps a page in one instance's memory.
  // It also lets the client router reuse a page for 30 seconds after an in-app navigation.
  cacheLife: { forever: { stale: 30, revalidate: Infinity, expire: Infinity } },
  env: {
    // Public URL of the "assets" bucket that holds copies of lead images. Not a secret: the bucket is public_read.
    NEXT_PUBLIC_ASSETS_URL: process.env.AWS_ENDPOINT_URL_S3 ? `${process.env.AWS_ENDPOINT_URL_S3}/assets` : '',
  },
  // No page may be framed by another site (clickjacking), and browsers must not guess content types.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },
  // Special pages have their own routes, so the article route never has to handle them.
  async rewrites() {
    return [
      { source: '/wiki/Special\\:Search', destination: '/special/search' },
      { source: '/wiki/Special%3ASearch', destination: '/special/search' },
      { source: '/wiki/Special\\:Random', destination: '/special/random' },
      { source: '/wiki/Special%3ARandom', destination: '/special/random' },
    ]
  },
}

export default nextConfig
