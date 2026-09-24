# Wikipedia on Neon

All 6,407,814 articles of English Wikipedia (the 1 November 2023 dump), served live from [Neon Postgres](https://neon.com) with a UI that mirrors Wikipedia's Vector 2022 skin. Articles, suggestions and searches are read from the database on request.

## Design notes

- **[Next.js 16](https://nextjs.org)** App Router with React Server Components, on Next.js's default rendering, caching and prefetching. Articles stream in steps (the shell at once, then the text, then the link check), each Main Page box streams on its own, and a click shows the next page's placeholder immediately.
- **Neon over `@neondatabase/serverless`** (SQL over HTTP, no pool) with **[Drizzle](https://orm.drizzle.team)** for the schema and the simple lookups. Search SQL lives in [`src/lib/queries.ts`](src/lib/queries.ts), with plans pinned per query shape through `SET LOCAL` in a transaction.
- **[shadcn/ui](https://ui.shadcn.com)** components (Base UI), themed onto Wikipedia's Codex palette in [`src/tokens.css`](src/tokens.css): 2px corners, `#36c` links, system sans-serif at 16/26px, serif titles and section headings. The Appearance menu (text size, width, light/dark/automatic) and the pinnable Contents and Appearance panels behave like Vector's, with the same 1120px breakpoint.
- **Articles are plain text.** The dump keeps paragraphs, list items, section headings and categories as lines, and [`src/lib/wikitext.ts`](src/lib/wikitext.ts) turns them back into sections, a table of contents and the category box. Heading levels were not kept, so every heading renders as a section heading. "See also" items become links, blue or red depending on whether the article exists (one query per page).

- **Database time is measured inside Postgres.** Every query runs in a one-round-trip transaction that reads `clock_timestamp()` before and after it, so pages report the time Postgres spent separately from the network: the article footer ("3.1 ms of database time"), each Main Page box, the search summary, and a `Server-Timing` header on `/api/search` and `/api/suggest`.
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

3. **Build the indexes and the typo lexicon.** The BM25 and GIN indexes over every article each take a while:

   ```bash
   npm run db:migrate
   npm run db:lexicon
   ```

4. **(Optional) Warm the cache** so the first searches after a restart are fast. On computes of 18 CU and up the whole cache is shared buffers; smaller computes also fill Neon's Local File Cache, which the script reports through the `neon` extension:

   ```bash
   npm run db:prewarm
   ```

5. **Run it.**

   ```bash
   npm run dev
   ```

### Scripts

| Command                 | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `npm run dev` / `build` | Next.js dev server / production build                       |
| `npm run typecheck`     | `tsc --noEmit`                                              |
| `npm run db:download`   | Download and verify the English Parquet files into `./data` |
| `npm run db:ingest`     | Parallel `COPY` of every article into Postgres (resumable)  |
| `npm run db:migrate`    | Extensions, tables and search indexes from `drizzle/*.sql`  |
| `npm run db:lexicon`    | Rebuild the `search_terms` typo lexicon from article titles |

## Deployment

Deploy on Vercel in `cle1` (Cleveland), next to the Neon compute in `us-east-2`, to keep each SQL-over-HTTP round trip short. Set `DATABASE_URL_UNPOOLED` to the direct Neon connection string.

Text is from Wikipedia under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This is an unofficial mirror, not affiliated with the Wikimedia Foundation.
