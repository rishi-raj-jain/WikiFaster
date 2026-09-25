# Wikipedia on Neon

All 6,407,814 articles of English Wikipedia (the 1 November 2023 dump), served live from [Neon Postgres](https://neon.com) with a UI that mirrors Wikipedia's Vector 2022 skin. Articles, suggestions and searches are read from the database on request.

## How a request is served

Pages are cached whole, until they are revalidated, and nothing below them is cached. The homepage and the article pages cache their full render with `use cache` and a `forever` cache profile (no time-based revalidation, see `next.config.ts`), which Vercel serves as ISR. An article's first visit waits while a Vercel Function in `cle1` (Cleveland, next to the Neon compute in `us-east-2`) renders it. Every later visit gets the finished page from the cache as plain HTML, with no function work, no queries and no loading placeholder. Search, suggestions and Special:Random are never cached.

Each cached page is tagged with its title and with `wiki`. `POST /api/revalidate?title=<title>` refreshes one page, `?title=Main_Page` refreshes the homepage (both `/` and `/wiki/Main_Page`, with new picks), and `POST /api/revalidate` refreshes all of them. Both need `Authorization: Bearer $REVALIDATE_SECRET`. The next visit still gets the cached page while it renders again in the background, and later visits get the new one:

```bash
curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" "https://wikifaster.vercel.app/api/revalidate?title=Albert_Einstein"
```

```mermaid
flowchart LR
  B([Browser]) -->|1. request| CDN{{Vercel CDN<br/>page cache, until revalidated}}
  CDN -->|hit: finished page| B
  CDN -->|2. miss| F[Vercel Function<br/>Next.js, cle1]
  F -->|3. queries| N[(Neon Postgres<br/>us-east-2)]
  F -->|4. the page, then caches it| CDN
  F -.->|5. after the response| Q[(image_queue)]
  T[Neon Function<br/>every minute] --> Q
  T -->|copies thumbnails| S[(Neon Object Storage<br/>assets bucket)]
  B -.->|lead images, through the CDN| S
```

| Step                  | Main Page `/`                                                                                     | Search `/wiki/Special:Search?search=…`                                                                                                                                                             | Article `/wiki/<title>`                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Vercel CDN         | The whole page, prerendered at build and kept until revalidated, so everyone sees the same picks. | Rewritten to `/special/search`. The prerendered search shell at once, never the results.                                                                                                           | A cache hit is the finished page.                                                                                                                                                 |
| 2. Vercel Function    | Only after a revalidation: renders the page again in the background.                              | Reads the query. An exact title jumps straight to the article ("Go"). Otherwise the results component takes over in the browser.                                                                   | On a miss: renders the article, then stores the page until revalidated. A wrong spelling caches as a meta refresh to the stored title. `/wiki/Main_Page` is prerendered like `/`. |
| 3. Neon Postgres      | Five queries in parallel (count, featured, did you know, random, on this day), once per render.   | Every search: the exact-title check, then `/api/search` from the browser (query analysis, BM25 results and the exact count, in parallel). Suggestions come from `/api/suggest` on every keystroke. | Once per render: the article and its alphabetical neighbours in one round trip (a wrong-case title also looks up the stored spelling), then the "See also" link check.            |
| 4. After the response | Queues lead images not yet copied into Object Storage.                                            | Same, for the images in the results and suggestions.                                                                                                                                               | Same, for the lead image.                                                                                                                                                         |
| Timing bar            | What the render's queries cost, stored with the page.                                             | The search's total time (also in a `Server-Timing` header).                                                                                                                                        | What the render's queries cost, stored with the page.                                                                                                                             |

Special:Random picks an article on every visit and redirects to it. Social cards (`/og.png` and `/og/<title>`) are images the CDN keeps for a day. Lead image copies load through `/assets/thumbs/<hash>/250`, which the CDN keeps for a year in every region, so they come from next to the visitor rather than from the bucket in `us-east-2`.

## Design notes

- **[Next.js 16](https://nextjs.org)** App Router with React Server Components and [Cache Components](https://nextjs.org/docs/app/getting-started/caching): the homepage and article pages cache their whole render until revalidated (`use cache`), with nothing cached below them. Article pages render with no Suspense boundary (`instant = false`), so a cached page is plain HTML with the article in the first paint: React holds a streamed boundary over 12.8 KB until 300 ms after its placeholder paints. A click still shows the next page's placeholder immediately.
- **[Drizzle](https://orm.drizzle.team) on `@neondatabase/serverless`** (SQL over HTTP, no pool), from [`src/db/index.ts`](src/db/index.ts). Components query `db` directly: the article page in [`article-view.tsx`](src/components/article-view.tsx), the Main Page in [`main-page.tsx`](src/components/main-page.tsx), suggestions in [`/api/suggest`](src/app/api/suggest/route.ts), and search in [`src/lib/search/`](src/lib/search). Simple lookups use the query builder and the rest is SQL in `` sql`…` `` templates. `db.batch` sends several statements in one round trip, which is how search pins its plans: a `set_config(…, true)` statement ahead of the query sets its planner settings and statement timeout for that transaction only.
- **[shadcn/ui](https://ui.shadcn.com)** components (Base UI), themed onto Wikipedia's Codex palette in [`src/tokens.css`](src/tokens.css): 2px corners, `#36c` links, system sans-serif at 16/26px, serif titles and section headings. The Appearance menu (text size, width, light/dark/automatic) and the pinnable Contents and Appearance panels behave like Vector's, with the same 1120px breakpoint.
- **Articles are plain text.** The dump keeps paragraphs, list items, section headings and categories as lines, and [`src/lib/wikitext.ts`](src/lib/wikitext.ts) turns them back into sections, a table of contents and the category box. Heading levels were not kept, so every heading renders as a section heading. "See also" items become links, blue or red depending on whether the article exists (one query per page).
- **Lead images come from `page_props`.** The Hugging Face text has no images, not even file names. Wikipedia's `page_props` dump names each article's freely licensed lead image by page ID, which is also `articles.id`, so it loads into `article_images` without matching titles. Each article, search result and suggestion reads its image in the same query as its text, through a primary-key probe. Each image links to its file page on Wikipedia for credit.
- **Images are copied into Neon Object Storage.** A [Function Trigger](https://neon.com/docs/compute/functions/triggers/overview) runs the `images` function ([`functions/images.ts`](functions/images.ts)) every minute. It drains `image_queue` for most of the minute: for each queued article it fetches the 250px thumbnail straight from Wikimedia's thumbnail CDN (through Wikipedia's file redirect for files not on Commons), uploads it as it came to the public `assets` bucket, and only then sets `article_images.stored`, for every article that uses that file. Articles people view go first (the app queues an image it had to load from Wikimedia), then the backfill of every image, largest articles first. Until an image is copied, pages load it from Wikimedia. Wikimedia sets the pace: its [Robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy) allows 2 media downloads at a time, and a 429 comes with a Retry-After that the function waits out, so the backfill runs at about 550 files a minute. A file that 404s (deleted since the dump) is dropped, and other failures are retried up to 5 times.
- **Every page shows what its queries cost.** Each page times its queries with `performance.now()`, and the timing bar under its tabs shows the total, including the round trips to Neon. `/api/search` and `/api/suggest` send the total in a `Server-Timing` header.
- **Every article has its own social card.** [`src/app/og/[...title]/route.tsx`](src/app/og/%5B...title%5D/route.tsx) draws the title, opening sentence and lead image under the WikiFaster name with `next/og`, and the CDN keeps each one for a day. Other pages share the WikiFaster card at [`/og.png`](src/app/og.png/route.tsx).
- **Interactive UI loads on first use.** The search combobox, the main menu and the Appearance and Contents popovers render as plain HTML, and their code loads when they are first pointed at, focused or clicked ([`useLazyOpen`](src/components/lazy-open.tsx), [`SearchField`](src/components/search-field.tsx)). The Contents scroll area and the Appearance radios are native elements. A page hydrates little more than React and Next.js themselves.
- **No debounce.** Suggestions and results are queried on every keystroke, and each new request aborts the one before it.
- **Disambiguation pages link their entries.** On pages whose lead says "may refer to", each entry links to its article when that article exists (one query for the whole page).

### Search

Every query shape has an index behind it:

| Query                            | Index                                                         | How                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Exact title (`/wiki/…`, "Go")    | `articles_title_key` (unique btree)                           | Direct lookup. A wrong-case title redirects through `lower(title)`.                                                      |
| Suggestions while typing         | `articles_title_prefix_idx` (`lower(title) text_pattern_ops`) | Prefix walk, exact match first, then the longest articles as a stand-in for popularity.                                  |
| Substrings and misspelled titles | `articles_title_trgm_idx` (trigram GIN)                       | `LIKE '%…%'` when prefixes run out, trigram similarity when nothing else matches.                                        |
| 1-2 character queries            | `articles_title_prefix_idx`                                   | Title prefix.                                                                                                            |
| Only stopwords ("The Who")       | `articles_title_trgm_idx`                                     | The english tsvector indexes none of those words, so titles containing the phrase are matched instead.                   |
| Full text, ranked                | `articles_search_bm25` (`lakebase_bm25`)                      | The top candidates come straight off the BM25 index and are kept when they match every word.                             |
| Full text, rare ANDs and phrases | `articles_search_gin` (GIN)                                   | When the ranked candidates leave the page short, all matches are collected through GIN and ranked exactly.               |
| Exact result counts              | `articles_search_gin`                                         | A bitmap scan reports how many rows it matched without reading the table, so "Results 1 – 20 of N" is exact at any size. |
| Typos ("einstien")               | `search_terms` lexicon (trigram GIN + `fuzzystrmatch`)        | Up to 3 edits for long words, only toward much more common words. Zero hits search the correction instead.               |

Both full-text indexes are built on the expression `to_tsvector('english', title || ' ' || text)` instead of a stored column, so the 15 GB table never had to be rewritten. Phrases, hyphenated words and negations need word positions from the table, so their count is exact when it finishes within 1.5s, and otherwise shown as "about N", where N is the exact GIN count of all the words combined (an upper bound).

### Gaps in the dump

The Hugging Face export (`wikimedia/wikipedia`, `20231101.en`) leaves out some pages entirely, so they are missing here too: date and year articles ("September 24", "1924") and a number of major articles such as London, Paris, World War II and The Who. "On this day" falls back to the day's Eastern Orthodox liturgical calendar page, which the dump does include.

## Local dev

1. **Install and configure.**

   ```bash
   npm install
   cp .env.example .env   # fill in DATABASE_URL_UNPOOLED
   ```

2. **Load the data** (Python 3 with `pyarrow`, `huggingface_hub` and `psycopg` in `./venv`). The download is 11.6 GB of Parquet and the ingest streams it into Postgres with parallel `COPY`, resumable at any point:

   ```bash
   npm run db:download
   npm run db:ingest
   ```

3. **Build the indexes and the typo lexicon, and load the lead images.** The BM25 and GIN indexes over every article each take a while. The images come from Wikipedia's latest `page_props` dump (about 470 MB):

   ```bash
   npm run db:migrate
   npm run db:lexicon
   npm run db:images
   ```

4. **(Optional) Warm the cache** so the first searches after a restart are fast. On computes of 18 CU and up the whole cache is shared buffers; smaller computes also fill Neon's Local File Cache, which the script reports through the `neon` extension:

   ```bash
   npm run db:prewarm
   ```

5. **Run it.**

   ```bash
   npm run dev
   ```

6. **(Optional) Copy images into Object Storage.** [`neon.ts`](neon.ts) declares the `assets` bucket, the `images` function and its every-minute trigger. Deploy them to your branch:

   ```bash
   neon deploy --project-id <project> --branch <branch> --no-env-pull
   ```

   Without a deploy, every image keeps loading from Wikimedia. To copy every image instead of only the viewed ones, queue them all once (about 2.2M files, a few days at Wikimedia's pace). Progress is `SELECT count(stored), count(*) FROM article_images`:

   ```bash
   npm run db:images -- --queue-all
   ```

### Scripts

| Command                            | Purpose                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `npm run dev` / `build`            | Next.js dev server / production build                       |
| `npm run typecheck`                | `tsc`                                                       |
| `npm run format`                   | Prettier over the repo                                      |
| `npm run db:download`              | Download and verify the English Parquet files into `./data` |
| `npm run db:ingest`                | Parallel `COPY` of every article into Postgres (resumable)  |
| `npm run db:migrate`               | Extensions, tables and search indexes from `drizzle/*.sql`  |
| `npm run db:lexicon`               | Rebuild the `search_terms` typo lexicon from article titles |
| `npm run db:images`                | Load each article's lead image from the `page_props` dump   |
| `npm run db:images -- --queue-all` | Queue every image without a copy for the `images` function  |
| `npm run db:prewarm`               | Load every index into the compute's cache                   |
| `npm run db:generate`              | Generate a migration from `src/db/schema.ts` (drizzle-kit)  |

## Deployment

Deploy on Vercel in `cle1` (Cleveland), next to the Neon compute in `us-east-2`, to keep each SQL-over-HTTP round trip short. Set `DATABASE_URL_UNPOOLED` to the direct Neon connection string, and `AWS_ENDPOINT_URL_S3` to the branch's storage endpoint so pages use the bucket copies of images (only the endpoint is read, at build time, and it is not a secret). Without it, images load from Wikimedia. Set `REVALIDATE_SECRET` to a long random string (`openssl rand -hex 32`) to enable `/api/revalidate`. Without it, the endpoint refuses every request.

Text and images are from Wikipedia and Wikimedia Commons. Text is under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This is an unofficial mirror, not affiliated with the Wikimedia Foundation.
