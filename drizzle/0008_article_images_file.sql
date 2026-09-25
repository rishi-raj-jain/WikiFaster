-- Articles that share an image file (flags, seals, maps: 2.2M files across
-- 2.5M articles) are copied once. When the images function copies a file, it
-- points every article with that file at the copy through this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS article_images_file_idx ON article_images (file);
