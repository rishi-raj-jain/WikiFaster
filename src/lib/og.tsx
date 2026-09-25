import { NEON_LOGOMARK, NEON_WORDMARK, VERCEL_TRIANGLE } from '@/components/logos'
import { imageSourceUrl, OG_IMAGE, SITE_URL, type ImageRef } from '@/lib/links'
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The pieces of WikiFaster's social cards (`/og.png` and `/og/<title>`),
 * drawn with `next/og` in black on white. The Neon logomark keeps its green,
 * and "Faster" takes a deeper green that reads on white.
 */
export const OG = { bg: '#ffffff', border: '#e5e7eb', text: '#000000', subtle: '#4b5563', green: '#00e599', greenText: '#00a36c' }

/**
 * Geist Regular and Bold (SIL Open Font License), bundled as TrueType since
 * the image renderer reads TTF, OTF and WOFF but not WOFF2.
 */
const [regular, bold] = await Promise.all([readFile(join(process.cwd(), 'src/lib/fonts/Geist-Regular.ttf')), readFile(join(process.cwd(), 'src/lib/fonts/Geist-Bold.ttf'))])

/** A 1200×630 card in Geist. */
export function ogResponse(card: React.ReactElement, headers?: Record<string, string>): ImageResponse {
  return new ImageResponse(card, {
    width: OG_IMAGE.width,
    height: OG_IMAGE.height,
    headers,
    fonts: [
      { name: 'Geist', data: regular, weight: 400, style: 'normal' },
      { name: 'Geist', data: bold, weight: 700, style: 'normal' },
    ],
  })
}

/** The white background with a faint Neon green glow, laid out top to bottom. */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 76px',
        background: OG.bg,
        backgroundImage: 'radial-gradient(circle at 88% 0%, rgba(0, 229, 153, 0.14), transparent 55%)',
        color: OG.text,
        fontFamily: 'Geist',
      }}
    >
      {children}
    </div>
  )
}

/** "WikiFaster", with "Faster" in green. */
export function Wordmark({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', fontSize: size, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1 }}>
      <span>Wiki</span>
      {/* The renderer spaces separate text runs apart, so this pulls "Faster" back to where one word would put it. */}
      <span style={{ marginLeft: '-0.13em', color: OG.greenText }}>Faster</span>
    </div>
  )
}

/** The Neon logo (green logomark) + the Vercel triangle and name, `height` tall. */
export function Logos({ height }: { height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: height * 0.64 }}>
      <svg width={157 * (height / 45)} height={height} viewBox="0 0 157 45" fill={OG.text}>
        <path d={NEON_LOGOMARK} fill={OG.green} />
        <path d={NEON_WORDMARK} />
      </svg>
      <div style={{ display: 'flex', fontSize: height * 0.77, color: OG.subtle }}>+</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: height * 0.32 }}>
        <svg width={height * 0.86} height={height * 0.86} viewBox="0 0 16 16" fill={OG.text}>
          <path d={VERCEL_TRIANGLE} />
        </svg>
        <div style={{ display: 'flex', fontSize: height, fontWeight: 700, letterSpacing: '-0.03em' }}>Vercel</div>
      </div>
    </div>
  )
}

/** The rule and the row along the bottom of a card: `left` and the logos. */
export function Footer({ left, logoHeight }: { left: React.ReactNode; logoHeight: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 32, borderTop: `1px solid ${OG.border}` }}>
      <div style={{ display: 'block', maxWidth: 640, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 26, color: OG.subtle }}>{left}</div>
      <Logos height={logoHeight} />
    </div>
  )
}

/**
 * The lead image as a data URL, so a slow or failing image host cannot break
 * the card. Null for anything but a PNG or JPEG (the formats the renderer
 * reads) and when the fetch fails or takes over three seconds.
 */
export async function leadImageData(image: ImageRef): Promise<string | null> {
  try {
    const res = await fetch(imageSourceUrl(image), { headers: { 'User-Agent': `WikiFaster (${SITE_URL})` }, signal: AbortSignal.timeout(3000) })
    const type = res.headers.get('content-type')?.split(';')[0] ?? ''
    if (!res.ok || !['image/png', 'image/jpeg'].includes(type)) return null
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}
