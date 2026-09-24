"""Load the English Wikipedia Parquet files from ./data into Postgres.

Usage: python scripts/ingest.py [--workers 8]
The connection string comes from DATABASE_URL_UNPOOLED, or from DATABASE_URL_UNPOOLED in ./.env.

The data is split into chunks of row groups. Several workers stream chunks in parallel
with COPY, each chunk in its own transaction along with a row in ingest_progress. A rerun
skips finished chunks, so an interrupted load resumes without duplicates. The primary
key is added once, after every chunk is in, because building it at the end is much
faster than checking it on every insert.
"""

import argparse
import os
import queue
import sys
import threading
import time
from pathlib import Path

import psycopg
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv
import pyarrow.parquet as pq

from load import download

CHUNK_ROW_GROUPS = 10  # about 10,000 articles per transaction
BATCH_ROW_GROUPS = 5  # row groups converted to CSV at a time
RETRIES = 3
COLUMNS = ["id", "url", "title", "text"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    id bigint NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    text text COMPRESSION lz4 NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_progress (
    chunk text PRIMARY KEY,
    rows integer NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now()
);
"""
COPY_SQL = "COPY articles (id, url, title, text) FROM STDIN (FORMAT csv)"


def database_url():
    if url := os.environ.get("DATABASE_URL_UNPOOLED"):
        return url
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "DATABASE_URL_UNPOOLED":
                return value.strip().strip("\"'")
    sys.exit("Set DATABASE_URL_UNPOOLED or add it to .env")


def chunks(paths):
    """Yield (name, path, row_groups) work units covering every row group of every file."""
    for path in paths:
        count = pq.ParquetFile(path).metadata.num_row_groups
        for start in range(0, count, CHUNK_ROW_GROUPS):
            groups = list(range(start, min(start + CHUNK_ROW_GROUPS, count)))
            yield f"{path.name}:{groups[0]}-{groups[-1]}", path, groups


def to_csv(table):
    """Encode a table as Postgres-ready CSV. Quoting every value keeps empty strings non-NULL."""
    # Postgres text columns can't hold NUL bytes.
    table = pa.table({c: pc.replace_substring(table[c], "\x00", "") for c in COLUMNS})
    sink = pa.BufferOutputStream()
    csv.write_csv(table, sink, csv.WriteOptions(include_header=False, quoting_style="all_valid"))
    return memoryview(sink.getvalue())


def copy_chunk(conn, name, path, groups):
    """COPY one chunk and record it as done, atomically. Returns the row count."""
    parquet = pq.ParquetFile(path)
    rows = 0
    with conn.transaction():
        with conn.cursor().copy(COPY_SQL) as copy:
            for i in range(0, len(groups), BATCH_ROW_GROUPS):
                table = parquet.read_row_groups(groups[i : i + BATCH_ROW_GROUPS], columns=COLUMNS)
                rows += table.num_rows
                copy.write(to_csv(table))
        conn.execute("INSERT INTO ingest_progress (chunk, rows) VALUES (%s, %s)", (name, rows))
    return rows


def connect(url):
    conn = psycopg.connect(url, autocommit=True)
    # Commits don't wait for the WAL flush. A crash can only lose whole chunks,
    # and ingest_progress rolls back with them, so a rerun reloads them.
    conn.execute("SET synchronous_commit = off")
    return conn


def worker(url, todo, progress, errors):
    conn = connect(url)
    try:
        while not errors:
            try:
                name, path, groups = todo.get_nowait()
            except queue.Empty:
                return
            for attempt in range(1, RETRIES + 1):
                try:
                    progress(name, copy_chunk(conn, name, path, groups))
                    break
                except psycopg.OperationalError as e:
                    if attempt == RETRIES:
                        raise
                    print(f"{name}: connection error ({e}), retrying", flush=True)
                    conn.close()
                    time.sleep(5 * attempt)
                    conn = connect(url)
    except Exception as e:
        errors.append(e)
    finally:
        conn.close()


def finalize(url, expected_rows):
    """Add the primary key, update planner stats, and check the row count."""
    with connect(url) as conn:
        has_pkey = conn.execute(
            "SELECT 1 FROM pg_constraint WHERE conrelid = 'articles'::regclass AND contype = 'p'"
        ).fetchone()
        if not has_pkey:
            print("Adding primary key", flush=True)
            conn.execute("SET maintenance_work_mem = '512MB'")
            conn.execute("ALTER TABLE articles ADD PRIMARY KEY (id)")
        conn.execute("ANALYZE articles")
        count = conn.execute("SELECT count(*) FROM articles").fetchone()[0]
        size = conn.execute("SELECT pg_size_pretty(pg_total_relation_size('articles'))").fetchone()[0]
    if count != expected_rows:
        sys.exit(f"Row count mismatch: {count:,} in articles, {expected_rows:,} in Parquet")
    print(f"Done: {count:,} articles, {size}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=8, help="parallel connections (default 8)")
    args = parser.parse_args()
    url = database_url()

    paths = download()
    expected_rows = sum(pq.ParquetFile(p).metadata.num_rows for p in paths)
    all_chunks = list(chunks(paths))

    with connect(url) as conn:
        conn.execute(SCHEMA)
        done = {row[0] for row in conn.execute("SELECT chunk FROM ingest_progress")}

    todo = queue.Queue()
    for chunk in all_chunks:
        if chunk[0] not in done:
            todo.put(chunk)
    total = todo.qsize()
    print(f"{len(all_chunks) - total} of {len(all_chunks)} chunks already loaded, {total} to go")

    lock = threading.Lock()
    loaded = {"chunks": 0, "rows": 0}
    start = time.monotonic()

    def progress(name, rows):
        with lock:
            loaded["chunks"] += 1
            loaded["rows"] += rows
            elapsed = time.monotonic() - start
            rate = loaded["rows"] / elapsed
            left = (total - loaded["chunks"]) * elapsed / loaded["chunks"]
            print(
                f"[{loaded['chunks']}/{total}] {name} | {loaded['rows']:,} rows, "
                f"{rate:,.0f} rows/s, ~{left / 60:.0f} min left",
                flush=True,
            )

    errors = []
    threads = [
        threading.Thread(target=worker, args=(url, todo, progress, errors))
        for _ in range(min(args.workers, total))
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        sys.exit(f"Stopped after an error: {errors[0]!r}\nRerun to resume from where it left off.")

    finalize(url, expected_rows)


if __name__ == "__main__":
    main()
