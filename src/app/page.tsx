import { MainPage } from '@/components/main-page'
import { MAIN_PAGE_METADATA } from '@/lib/seo'
import type { Metadata } from 'next'
import { connection } from 'next/server'

export const metadata: Metadata = MAIN_PAGE_METADATA

/** Rendered on every request, so each visit queries Postgres and picks new random articles. */
export default async function Page() {
  await connection()
  return <MainPage />
}
