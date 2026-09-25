import { MainPage } from '@/components/main-page'
import { MAIN_PAGE } from '@/lib/links'
import { MAIN_PAGE_METADATA } from '@/lib/seo'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'

export const metadata: Metadata = MAIN_PAGE_METADATA

/**
 * The whole Main Page, cached until it is revalidated (see `/api/revalidate`),
 * so everyone sees the same picks until then. Tagged like `/wiki/Main_Page`.
 */
export default async function Page() {
  'use cache'
  cacheLife('forever')
  cacheTag('wiki', MAIN_PAGE)
  return <MainPage />
}
