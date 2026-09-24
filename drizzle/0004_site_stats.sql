-- Exact article count for the Main Page, kept like Wikipedia's site_stats:
-- one row, maintained by statement-level triggers so COPY and bulk deletes
-- update it once per statement. Reading it costs one row instead of counting
-- 6.4M entries on every view.
CREATE TABLE IF NOT EXISTS site_stats (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  articles bigint NOT NULL
);

INSERT INTO site_stats (articles) SELECT count(*) FROM articles
ON CONFLICT (id) DO UPDATE SET articles = excluded.articles;

CREATE OR REPLACE FUNCTION site_stats_count_articles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE site_stats SET articles = articles + (SELECT count(*) FROM changed);
  ELSE
    UPDATE site_stats SET articles = articles - (SELECT count(*) FROM changed);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS articles_count_insert ON articles;
CREATE TRIGGER articles_count_insert AFTER INSERT ON articles REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION site_stats_count_articles();

DROP TRIGGER IF EXISTS articles_count_delete ON articles;
CREATE TRIGGER articles_count_delete AFTER DELETE ON articles REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION site_stats_count_articles();
