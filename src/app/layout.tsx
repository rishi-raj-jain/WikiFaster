import { PendingNavigation } from '@/components/pending-navigation'
import { PREFS_SCRIPT, PrefsProvider } from '@/components/prefs'
import { SiteHeader } from '@/components/site-header'
import { LICENSE_URL, OG_IMAGE, SITE_URL } from '@/lib/links'
import type { Metadata, Viewport } from 'next'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

/** Site-wide <head> defaults, as on Wikipedia. Each route sets its title, canonical URL and robots through `pageMetadata`. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Wikipedia, the free encyclopedia',
    template: '%s - Wikipedia',
  },
  referrer: 'origin-when-cross-origin',
  formatDetection: { telephone: false },
  openGraph: { type: 'website', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
}

/** Neon UI's mono face, for the timing bar's numbers. */
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The head script sets Appearance data attributes and the dark class before paint.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
        <link rel="license" href={LICENSE_URL} />
        <link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml" title="Wikipedia on Neon" />
      </head>
      <body className={`min-h-dvh ${geistMono.variable}`}>
        <PrefsProvider>
          <PendingNavigation header={<SiteHeader />}>{children}</PendingNavigation>
        </PrefsProvider>
      </body>
    </html>
  )
}
