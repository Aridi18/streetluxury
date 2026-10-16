"""Operational commands: ``python -m app.cli <command>``."""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request

from .config import get_settings

AASIST_URL = "https://raw.githubusercontent.com/clovaai/aasist/main/models/weights/AASIST.pth"
# SHA-256 of the official AASIST.pth (clovaai/aasist, main branch); downloads are verified against it.
AASIST_SHA256 = "51d2d9cf0738172f61e2a384ec50a54a55363240f67c971ed55a92435bc1a1c0"


def download_models(_args) -> int:
    import hashlib

    s = get_settings()
    s.model_dir.mkdir(parents=True, exist_ok=True)
    print(f"Model directory: {s.model_dir}")
    try:
        from huggingface_hub import hf_hub_download

        p = hf_hub_download(
            s.antideepfake_repo, "model.safetensors", revision=s.antideepfake_revision, cache_dir=str(s.model_dir)
        )
        print(f"AntiDeepfake weights: {p}")
        print("  Licence: CC BY-NC-SA 4.0 (non-commercial). See THIRD_PARTY_NOTICES.md.")
    except ImportError:
        print("huggingface_hub is not installed; skipping AntiDeepfake (install backend[ml]).")
    dest = s.model_dir / "aasist" / "AASIST.pth"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        with urllib.request.urlopen(AASIST_URL, timeout=60) as r, open(dest, "wb") as fh:  # noqa: S310
            shutil.copyfileobj(r, fh)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if digest != AASIST_SHA256:
        dest.unlink()
        print(f"AASIST weights failed integrity check (sha256 {digest}); file removed.")
        return 1
    print(f"AASIST weights: {dest} (sha256 verified)")
    return 0


def create_schema(_args) -> int:
    from . import models  # noqa: F401
    from .db import Base, get_engine

    Base.metadata.create_all(get_engine())
    print("Schema created (use `alembic upgrade head` for managed deployments).")
    return 0


def purge(_args) -> int:
    from .db import session_scope
    from .services.retention import purge_expired

    with session_scope() as db:
        n = purge_expired(db)
    print(f"Purged audio of {n} recording(s).")
    return 0


def detectors(_args) -> int:
    import json

    from .jobs.worker import detector_status

    print(json.dumps(detector_status(), indent=2, default=str))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download-models", help="Download pretrained detector weights").set_defaults(fn=download_models)
    sub.add_parser("create-schema", help="Create database tables (development)").set_defaults(fn=create_schema)
    sub.add_parser("purge", help="Delete audio whose retention has expired").set_defaults(fn=purge)
    sub.add_parser("detectors", help="Show synthetic-speech detector status").set_defaults(fn=detectors)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
