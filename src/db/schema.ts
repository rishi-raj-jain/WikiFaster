import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

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

export type Article = typeof articles.$inferSelect

/**
 * Lexicon behind typo suggestions: title words and how many titles use each,
 * trigram-indexed for fuzzy lookup. Rebuilt by `npm run db:lexicon`.
 */
export const searchTerms = pgTable('search_terms', { word: text('word').primaryKey(), ndoc: integer('ndoc').notNull() }, (table) => [index('search_terms_word_trgm').using('gin', sql`${table.word} gin_trgm_ops`)])

/** One-row exact counters for the Main Page, kept current by triggers on `articles` (see drizzle/0004_site_stats.sql). */
export const siteStats = pgTable('site_stats', { id: boolean('id').primaryKey().default(true), articles: bigint('articles', { mode: 'number' }).notNull() })
