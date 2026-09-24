import { SITE_URL, searchHref } from '@/lib/links'

/** The OpenSearch description Wikipedia links from every page, so browsers can offer this site as a search engine. */
export function GET() {
  const template = `${SITE_URL}${searchHref('')}`.replace('search=', 'search={searchTerms}')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Wikipedia on Neon</ShortName>
  <Description>Search English Wikipedia, served live from Neon Postgres</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/svg+xml">${SITE_URL}/icon.svg</Image>
  <Url type="text/html" method="get" template="${template.replace(/&/g, '&amp;')}"/>
</OpenSearchDescription>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/opensearchdescription+xml; charset=utf-8' } })
}
