import { MainPage } from '@/components/main-page'
import { MAIN_PAGE_METADATA } from '@/lib/seo'
import type { Metadata } from 'next'
import { cacheLife } from 'next/cache'

export const metadata: Metadata = MAIN_PAGE_METADATA

/**
 * The whole Main Page, prerendered at build and served from the CDN as is,
 * so everyone sees the same picks until the cron job refreshes the path `/`
 * every 12 hours. `/wiki/Main_Page` is refreshed with it.
 */
export default async function Page() {
  'use cache'
  cacheLife('forever')
  return <MainPage />
}
