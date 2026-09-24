import { AppearancePanel } from '@/components/appearance-panel'
import { SOURCE_URL } from '@/lib/links'
import { cn } from 'cn'
import Link from 'next/link'

export type Tab = { label: string; href?: string; selected?: boolean; external?: boolean }

function Tabs({ tabs }: { tabs: Tab[] }) {
  return (
    <ul className="flex h-full items-stretch gap-4">
      {tabs.map((tab) => (
        <li key={tab.label} className={cn('flex items-center', tab.selected && 'shadow-[inset_0_-2px_0_var(--wiki-text)]')}>
          {tab.selected || !tab.href ? (
            <span className="text-foreground">{tab.label}</span>
          ) : tab.external ? (
            <a href={tab.href} target="_blank" rel="noreferrer">
              {tab.label}
            </a>
          ) : (
            <Link href={tab.href}>{tab.label}</Link>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * The page title (#firstHeading) with the Contents button beside it, and the
 * toolbar below: namespace tabs on the left, view tabs on the right.
 */
export function TitleBar({ title, tocButton, left = [], right = [], hideTitle = false }: { title: React.ReactNode; tocButton?: React.ReactNode; left?: Tab[]; right?: Tab[]; hideTitle?: boolean }) {
  return (
    <div>
      {hideTitle ? null : (
        <div className="border-border flex items-start border-b">
          {tocButton}
          <h1 className="wiki-title min-w-0 flex-1">{title}</h1>
        </div>
      )}
      <nav aria-label="Page tools" className="flex h-[33px] items-stretch justify-between text-sm shadow-[0_1px_0_var(--wiki-border-subtle)]">
        <Tabs tabs={left} />
        <Tabs tabs={right} />
      </nav>
    </div>
  )
}

export function Footer({ lines, links }: { lines: React.ReactNode[]; links: { label: string; href: string }[] }) {
  return (
    <footer className="border-border mt-8 border-t py-3 text-xs leading-relaxed">
      <ul className="flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  )
}

export const LICENSE_LINE = (
  <>
    Text is available under the{' '}
    <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
      Creative Commons Attribution-ShareAlike 4.0 License
    </a>
    , from the English Wikipedia dump of 1 November 2023. This is an unofficial mirror served from Neon Postgres, not affiliated with the Wikimedia Foundation.
  </>
)

export const FOOTER_LINKS = [
  { label: 'View source', href: SOURCE_URL },
  { label: 'Dataset', href: 'https://huggingface.co/datasets/wikimedia/wikipedia' },
  { label: 'Neon', href: 'https://neon.com' },
  { label: 'Wikipedia', href: 'https://en.wikipedia.org' },
]

/**
 * Vector 2022's page grid. From 1120px: the pinned Contents column, the
 * content, and the pinned Appearance column. Below that, or when unpinned,
 * both move into the header and title buttons. Pinning and width are read by
 * CSS from <html> data attributes. Pages with no sections pass no `toc`.
 */
export function PageLayout({ toc, children, footer }: { toc?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const hasToc = toc != null
  return (
    <div className="wiki-gutter bg-background mx-auto w-full max-w-(--wiki-page-max) pt-4 pb-2 min-[1120px]:pt-5">
      <div className={cn('wiki-page-grid', hasToc && 'has-toc')}>
        {hasToc ? <aside className="wiki-toc-column pt-[46px]">{toc}</aside> : null}
        <div className="wiki-main-grid">
          <main className="min-w-0">{children}</main>
          <aside className="wiki-appearance-column pt-[46px]">
            <div className="sticky top-6">
              <AppearancePanel pinned />
            </div>
          </aside>
        </div>
      </div>
      {footer}
    </div>
  )
}
