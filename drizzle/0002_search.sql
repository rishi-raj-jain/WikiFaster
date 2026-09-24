CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Title substrings (ILIKE '%…%'), misspelled titles (trigram similarity), and
-- queries made only of stopwords ("The Who"), which the english tsvector
-- indexes nothing for.
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx ON articles USING gin (lower(title) gin_trgm_ops);

-- Lexicon behind typo correction: title words and how many titles use each,
-- trigram-indexed for fuzzy lookup. Filled by `npm run db:lexicon`.
CREATE TABLE IF NOT EXISTS search_terms (
  word text PRIMARY KEY,
  ndoc integer NOT NULL
);
CREATE INDEX IF NOT EXISTS search_terms_word_trgm ON search_terms USING gin (word gin_trgm_ops);

-- Boolean full-text matching over the same expression as articles_search_bm25.
-- It serves the @@ filter for sparse matches, and a bitmap scan of it reports
-- the exact number of matching articles without reading the table, which is how
-- result counts stay exact at any size.
CREATE INDEX IF NOT EXISTS articles_search_gin ON articles USING gin ((to_tsvector('english', title || ' ' || text)));

-- Statistics for the planner, and a visibility map so count(*) is an
-- index-only scan of the primary key.
VACUUM (ANALYZE) articles;
