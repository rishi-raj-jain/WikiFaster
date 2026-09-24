-- Loaded by scripts/ingest.py with parallel COPY. The table and its primary key
-- already exist after an ingest, so this is safe to run before or after it.
CREATE TABLE IF NOT EXISTS articles (
  id bigint PRIMARY KEY,
  url text NOT NULL,
  title text NOT NULL,
  text text COMPRESSION lz4 NOT NULL
);

-- Article lookup by exact title (/wiki/<title>). Titles are unique in the dump.
CREATE UNIQUE INDEX IF NOT EXISTS articles_title_key ON articles (title);

-- Case-insensitive lookup and search-box prefix suggestions.
CREATE INDEX IF NOT EXISTS articles_title_prefix_idx ON articles (lower(title) text_pattern_ops);

-- Full-text BM25 over title and body, on an expression so the 15 GB table is not
-- rewritten to add a stored tsvector column. Queries must repeat this expression
-- exactly (see SEARCH_TSV in src/lib/queries.ts) for the planner to use it.
CREATE INDEX IF NOT EXISTS articles_search_bm25 ON articles USING lakebase_bm25 ((to_tsvector('english', title || ' ' || text)));

ANALYZE articles;
