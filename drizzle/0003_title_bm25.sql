-- BM25 over titles alone. Body BM25 normalizes by document length, so a long
-- article about a topic ("Albert Einstein") ranks below short pages that repeat
-- the word ("Einstein (surname)"). Ranking title matches separately lets the
-- search put the strongest ones first, the way Wikipedia's search favors titles.
CREATE INDEX IF NOT EXISTS articles_title_bm25 ON articles USING lakebase_bm25 ((to_tsvector('english', title)));
