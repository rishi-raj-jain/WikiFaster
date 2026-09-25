"""Load each article's lead image from Wikipedia's page_props dump into article_images.

Usage: python scripts/images.py [--dump latest]
       python scripts/images.py --queue-all
The connection string comes from DATABASE_URL_UNPOOLED, or from DATABASE_URL_UNPOOLED in ./.env.

The dump (about 470 MB) is downloaded into ./data and kept, so a rerun only fetches it
again when Wikimedia has published a newer one. Its rows are MySQL INSERT statements.
Only the `page_image_free` rows are read, streamed into a temporary table with COPY,
then merged into article_images for the page IDs that exist in articles. The merge is
an upsert plus a delete, so pages keep serving images while it runs and a rerun
changes only what differs. An article whose image changed loses its bucket copy
(`stored`), so the images function copies the new one.

--queue-all loads nothing. It queues every image that has no copy yet for the images
function, largest articles first (priority 1, 2, 3 …), behind the articles people view
(priority 0). Rows already queued keep their place.
"""

import argparse
import gzip
import re
import sys
import time
import urllib.request
from pathlib import Path

from ingest import connect, database_url

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DUMP_URL = "https://dumps.wikimedia.org/enwiki/{dump}/enwiki-{dump}-page_props.sql.gz"
# Wikimedia asks every client to identify itself.
USER_AGENT = "WikiFaster/1.0 (https://github.com/rishi-raj-jain/WikiFaster)"
PROPNAME = b"page_image_free"

# One (pp_page,'pp_propname','pp_value',pp_sortkey) row. Strings are MySQL-escaped.
ROW = re.compile(rb"\((\d+),'((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)',[^)]*\)", re.DOTALL)
ESCAPE = re.compile(rb"\\(.)", re.DOTALL)
ESCAPES = {b"0": b"\0", b"b": b"\b", b"n": b"\n", b"r": b"\r", b"t": b"\t", b"Z": b"\x1a"}


def unescape(value):
    return ESCAPE.sub(lambda m: ESCAPES.get(m[1], m[1]), value)


def request(url, method="GET", offset=0):
    headers = {"User-Agent": USER_AGENT}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    # A stalled transfer raises instead of hanging, and a rerun resumes it.
    return urllib.request.urlopen(urllib.request.Request(url, method=method, headers=headers), timeout=60)


def download(dump):
    """Fetch the dump unless the local copy already matches the published size. Returns its path."""
    url = DUMP_URL.format(dump=dump)
    path = DATA_DIR / url.rsplit("/", 1)[1]
    with request(url, "HEAD") as head:
        size = int(head.headers["Content-Length"])
    if path.exists() and path.stat().st_size == size:
        print(f"{path.name} already downloaded ({size / 1e6:.0f} MB)")
        return path

    DATA_DIR.mkdir(exist_ok=True)
    # The partial file is named after the dump's size, so a newer dump never resumes an older one.
    part = path.with_name(f"{path.name}.{size}.part")
    offset = part.stat().st_size if part.exists() else 0
    print(f"Downloading {url} ({size / 1e6:.0f} MB{f', resuming at {offset / 1e6:.0f} MB' if offset else ''})", flush=True)
    start = time.monotonic()
    with request(url, offset=offset) as response:
        # A server that ignores the Range header sends the whole file again.
        if response.status != 206:
            offset = 0
        with open(part, "ab" if offset else "wb") as out:
            done = offset
            while block := response.read1(1 << 20):
                out.write(block)
                done += len(block)
                if done % (50 << 20) < len(block):
                    print(f"  {done / 1e6:.0f} / {size / 1e6:.0f} MB, {(done - offset) / 1e6 / (time.monotonic() - start):.1f} MB/s", flush=True)
    if part.stat().st_size != size:
        sys.exit(f"Size mismatch: got {part.stat().st_size:,} bytes, expected {size:,}. Rerun to resume.")
    part.rename(path)
    return path


def lead_images(path):
    """Yield (page_id, file_name) for every page_image_free row in the dump."""
    with gzip.open(path, "rb") as dump:
        for line in dump:
            # Most lines are other properties. Skipping them before the regex is most of the speed.
            if PROPNAME not in line:
                continue
            for page, propname, value in ROW.findall(line):
                if propname == PROPNAME:
                    yield int(page), unescape(value).decode("utf-8", errors="replace")


def queue_all(url):
    """Queue every image without a copy, ordered by article size. Sizes come from pg_column_size, which reads no TOAST."""
    start = time.monotonic()
    with connect(url) as conn:
        conn.execute("SET work_mem = '256MB'")
        queued = conn.execute(
            """INSERT INTO image_queue (id, priority)
               SELECT i.id, row_number() OVER (ORDER BY pg_column_size(a.text) DESC, i.id)
               FROM article_images i JOIN articles a USING (id)
               WHERE i.stored IS NULL
               ON CONFLICT (id) DO NOTHING"""
        ).rowcount
        conn.execute("ANALYZE image_queue")
        pending = conn.execute("SELECT count(*) FROM image_queue WHERE attempts < 5").fetchone()[0]
    print(f"Queued {queued:,} images in {time.monotonic() - start:.0f}s, {pending:,} waiting to be copied")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dump", default="latest", help="dump date such as 20260901 (default latest)")
    parser.add_argument("--queue-all", action="store_true", help="queue every image without a copy, then exit")
    args = parser.parse_args()
    url = database_url()
    if args.queue_all:
        return queue_all(url)
    path = download(args.dump)

    with connect(url) as conn:
        if conn.execute("SELECT to_regclass('article_images')").fetchone()[0] is None:
            sys.exit("article_images is missing: run npm run db:migrate -- drizzle/0005_article_images.sql first")

        start = time.monotonic()
        with conn.transaction():
            conn.execute("CREATE TEMP TABLE page_images (id bigint PRIMARY KEY, file text NOT NULL) ON COMMIT DROP")
            rows = 0
            with conn.cursor().copy("COPY page_images (id, file) FROM STDIN") as copy:
                for row in lead_images(path):
                    copy.write_row(row)
                    rows += 1
                    if rows % 500_000 == 0:
                        print(f"  {rows:,} images read", flush=True)
            print(f"Read {rows:,} lead images in {time.monotonic() - start:.0f}s", flush=True)

            conn.execute("ANALYZE page_images")
            upserted = conn.execute(
                """INSERT INTO article_images (id, file)
                   SELECT p.id, p.file FROM page_images p WHERE EXISTS (SELECT 1 FROM articles a WHERE a.id = p.id)
                   ON CONFLICT (id) DO UPDATE SET file = excluded.file, stored = NULL
                   WHERE article_images.file <> excluded.file"""
            ).rowcount
            deleted = conn.execute(
                "DELETE FROM article_images i WHERE NOT EXISTS (SELECT 1 FROM page_images p WHERE p.id = i.id)"
            ).rowcount
        conn.execute("ANALYZE article_images")

        images, articles = conn.execute(
            "SELECT (SELECT count(*) FROM article_images), (SELECT articles FROM site_stats)"
        ).fetchone()
    share = f" ({images / articles:.0%} of {articles:,} articles)" if articles else ""
    print(f"Done in {time.monotonic() - start:.0f}s: {upserted:,} added or changed, {deleted:,} removed")
    print(f"{images:,} articles have a lead image{share}")


if __name__ == "__main__":
    main()
