-- Queue order for copying images. Articles people view are queued at 0 and go
-- first. The backfill (`npm run db:images -- --queue-all`) queues every other
-- image at 1, 2, 3 … by article size, largest first, so substantial articles
-- are copied before stubs. A view moves a backfill row to 0.
ALTER TABLE image_queue ADD COLUMN IF NOT EXISTS priority bigint NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS image_queue_pending_idx;
CREATE INDEX IF NOT EXISTS image_queue_next_idx ON image_queue (priority, queued_at) WHERE attempts < 5;
