import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * The full-text expression both search indexes are built on. Queries must
 * repeat it exactly for the planner to use them, so it is defined once here.
 */
export const SEARCH_TSV = `to_tsvector('english', title || ' ' || text)`

/** English Wikipedia (20231101 dump), one row per article, loaded by `scripts/ingest.py`. */
export const articles = pgTable(
  'articles',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    /** Plain text: paragraphs separated by blank lines, headings and list items on their own lines. */
    text: text('text').notNull(),
  },
  (table) => [
    uniqueIndex('articles_title_key').on(table.title),
    index('articles_title_prefix_idx').using('btree', sql`lower(${table.title}) text_pattern_ops`),
    index('articles_title_trgm_idx').using('gin', sql`lower(${table.title}) gin_trgm_ops`),
    // Ranking. lakebase_bm25 scores the top candidates straight off the index.
    index('articles_search_bm25').using('lakebase_bm25', sql.raw(SEARCH_TSV)),
    // Title-only BM25, so strong title matches can lead the results.
    index('articles_title_bm25').using('lakebase_bm25', sql`to_tsvector('english', ${table.title})`),
    // Boolean matching and exact counts (a bitmap scan counts matches without the heap).
    index('articles_search_gin').using('gin', sql.raw(SEARCH_TSV)),
  ],
)

/**
 * Each article's freely licensed lead image, by page ID: the file name on
 * Wikipedia or Commons ("Aristotle_Altemps_Inv8575.jpg"). Loaded from the
 * page_props dump by `scripts/images.py`. `stored` is the key prefix of its
 * copy in the "assets" bucket, set by the images function (`functions/images.ts`).
 */
export const articleImages = pgTable('article_images', { id: bigint('id', { mode: 'number' }).primaryKey(), file: text('file').notNull(), stored: text('stored') }, (table) => [
  index('article_images_file_idx').on(table.file),
])

/**
 * The lead image of the row aliased `from` as `{ file, stored }`, or null: one
 * probe of the `article_images` primary key. The alias is written out because
 * Drizzle renders `articles.id` as a bare "id" in a one-table select, which the
 * subquery would read as its own.
 */
export function leadImage(from = 'articles') {
  return sql<{ file: string; stored: string | null } | null>`(SELECT json_build_object('file', file, 'stored', stored) FROM article_images i WHERE i.id = ${sql.raw(from)}.id)`
}

/**
 * Articles whose lead image still needs copying into the bucket, drained by the
 * images function every minute in `priority` order: 0 for articles people
 * viewed, then the backfill by article size, largest first.
 */
export const imageQueue = pgTable(
  'image_queue',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    priority: bigint('priority', { mode: 'number' }).notNull().default(0),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (table) => [
    index('image_queue_next_idx')
      .on(table.priority, table.queuedAt)
      .where(sql`${table.attempts} < 5`),
  ],
)

/**
 * Lexicon behind typo suggestions: title words and how many titles use each,
 * trigram-indexed for fuzzy lookup. Rebuilt by `npm run db:lexicon`.
 */
export const searchTerms = pgTable('search_terms', { word: text('word').primaryKey(), ndoc: integer('ndoc').notNull() }, (table) => [index('search_terms_word_trgm').using('gin', sql`${table.word} gin_trgm_ops`)])

/** One-row exact counters for the Main Page, kept current by triggers on `articles` (see drizzle/0004_site_stats.sql). */
export const siteStats = pgTable('site_stats', { id: boolean('id').primaryKey().default(true), articles: bigint('articles', { mode: 'number' }).notNull() })
