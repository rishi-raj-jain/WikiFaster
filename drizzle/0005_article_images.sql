-- Each article's lead image, as Wikipedia's PageImages extension picks it:
-- the file name only ("Aristotle_Altemps_Inv8575.jpg"), keyed by the page ID
-- that `articles.id` already is. Loaded from the page_props dump by
-- `npm run db:images`. Only freely licensed images (`page_image_free`) are kept,
-- so non-free logos and posters stay on Wikipedia.
CREATE TABLE IF NOT EXISTS article_images (
  id bigint PRIMARY KEY,
  file text NOT NULL
);
