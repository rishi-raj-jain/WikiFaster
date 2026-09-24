"""Download English Wikipedia (20231101) as Parquet files into ./data.

Files are written straight to ./data instead of the Hugging Face cache. Only the raw
Parquet files are kept. There is no Arrow conversion or save_to_disk copy, since
ingestion into Postgres reads the Parquet files directly.
Safe to rerun: complete files are skipped and only missing or broken ones are fetched.
"""

import shutil
from pathlib import Path

import pyarrow.parquet as pq
from huggingface_hub import HfApi, snapshot_download

REPO_ID = "wikimedia/wikipedia"
CONFIG = "20231101.en"
# Pinned so reruns never mix files from different dataset versions.
REVISION = "b04c8d1ceb2f5cd4588862100d08de323dccfbaa"
MAX_WORKERS = 8
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def remote_files():
    """Return {path: size} for the dataset card and every Parquet file in CONFIG."""
    info = HfApi().dataset_info(REPO_ID, revision=REVISION, files_metadata=True)
    return {
        s.rfilename: s.size
        for s in info.siblings
        if s.rfilename == "README.md"
        or (s.rfilename.startswith(f"{CONFIG}/") and s.rfilename.endswith(".parquet"))
    }


def is_complete(path, size):
    return path.exists() and path.stat().st_size == size


def download():
    """Fetch any missing files, verify all of them, and return the local Parquet paths."""
    files = remote_files()
    missing = {f: size for f, size in files.items() if not is_complete(DATA_DIR / f, size)}
    print(f"{len(files) - len(missing)} of {len(files)} files already downloaded")

    if missing:
        DATA_DIR.mkdir(exist_ok=True)
        need = sum(missing.values())
        free = shutil.disk_usage(DATA_DIR).free
        if need * 1.1 > free:
            raise SystemExit(f"Need {need / 1e9:.1f} GB but only {free / 1e9:.1f} GB is free")

        # A partial or corrupt file could be treated as done, so remove it first.
        for f in missing:
            (DATA_DIR / f).unlink(missing_ok=True)

        print(f"Downloading {len(missing)} files ({need / 1e9:.1f} GB) with {MAX_WORKERS} workers")
        snapshot_download(
            REPO_ID,
            repo_type="dataset",
            revision=REVISION,
            allow_patterns=list(missing),
            local_dir=DATA_DIR,
            max_workers=MAX_WORKERS,
        )

    broken = [f for f in files if not is_complete(DATA_DIR / f, files[f])]
    if broken:
        raise SystemExit(f"Size mismatch after download: {broken}")

    paths = sorted(DATA_DIR / f for f in files if f.endswith(".parquet"))
    rows = sum(pq.ParquetFile(p).metadata.num_rows for p in paths)

    # Leftovers from interrupted runs only waste space.
    for leftover in DATA_DIR.rglob("*.incomplete"):
        leftover.unlink()

    total = sum(files.values())
    print(f"Verified {len(files)} files, {total / 1e9:.2f} GB, {rows:,} articles")
    print(f"Location: {DATA_DIR / CONFIG}")
    return paths


if __name__ == "__main__":
    download()
