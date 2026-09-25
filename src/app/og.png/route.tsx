import { SITE_URL } from '@/lib/links'
import { Footer, Frame, OG, ogResponse, Wordmark } from '@/lib/og'

/**
 * The social card for WikiFaster itself, the default `og:image` (see
 * `pageMetadata`): the name, what the demo is, and the Neon and Vercel logos.
 * Prerendered at build.
 */
export async function GET() {
  return ogResponse(
    <Frame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: OG.subtle }}>
        <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 7, background: OG.green }} />
        English Wikipedia · 6,407,814 articles
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Wordmark size={148} />
        <div style={{ display: 'flex', marginTop: 28, maxWidth: 940, fontSize: 38, lineHeight: 1.35, color: OG.subtle }}>Every article in Neon Postgres, with BM25 full-text search, streamed by Next.js on Vercel.</div>
      </div>
      <Footer left={new URL(SITE_URL).host} logoHeight={44} />
    </Frame>,
  )
}
