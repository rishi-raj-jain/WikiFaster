-- Copies of lead images in the public "assets" bucket, so pages stop loading
-- them from Wikimedia. `stored` is the object key prefix
-- ("thumbs/<sha1 of the file name>"), under which the images function writes
-- the 250px thumbnail ("…/250"). Null until copied.
ALTER TABLE article_images ADD COLUMN IF NOT EXISTS stored text;

-- Articles whose image was shown from Wikimedia and still needs copying. The
-- app adds rows after it responds, and the images function (a Function Trigger
-- that runs every minute) claims a batch, copies them and deletes the rows. A
-- claim older than 10 minutes is retried, up to 5 attempts, and `error` keeps
-- the last failure.
CREATE TABLE IF NOT EXISTS image_queue (
  id bigint PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error text
);

CREATE INDEX IF NOT EXISTS image_queue_pending_idx ON image_queue (queued_at) WHERE attempts < 5;
