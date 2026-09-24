import { MainPage } from '@/components/main-page'
import { MAIN_PAGE_METADATA } from '@/lib/seo'
import type { Metadata } from 'next'

export const metadata: Metadata = MAIN_PAGE_METADATA

/** The prerendered Main Page is rebuilt from Postgres at most every 12 hours (new featured article, random picks and "On this day"). */
export const revalidate = 43200

export default function Page() {
  return <MainPage />
}
