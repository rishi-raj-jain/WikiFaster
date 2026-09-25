import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    // Public URL of the "assets" bucket that holds copies of lead images. Not a secret: the bucket is public_read.
    NEXT_PUBLIC_ASSETS_URL: process.env.AWS_ENDPOINT_URL_S3 ? `${process.env.AWS_ENDPOINT_URL_S3}/assets` : '',
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
