import type { MetadataRoute } from 'next'

/** Like Wikipedia's robots.txt: articles are crawlable, special pages (search, random) and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/wiki/Special:', '/special/'] },
  }
}
