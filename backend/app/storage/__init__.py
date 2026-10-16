"""Private, encrypted object storage.

There are deliberately no public or pre-signed URLs: every byte of user audio is
streamed through authenticated API endpoints after an ownership check.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from collections.abc import Iterable, Iterator
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from ..config import Settings, get_settings
from .crypto import DEFAULT_CHUNK, HEADER_SIZE, TAG_SIZE, Header, ObjectCipher

_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$")


def validate_key(key: str) -> str:
    if not _KEY_RE.match(key) or ".." in key or key.startswith("/"):
        raise ValueError(f"invalid object key: {key!r}")
    return key


class RawBackend(Protocol):
    def write(self, key: str, parts: Iterable[bytes]) -> None: ...
    def read_range(self, key: str, start: int, length: int) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def exists(self, key: str) -> bool: ...


class LocalBackend:
    """Files on a private local directory (mode 0700, files 0600)."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)

    def _path(self, key: str) -> Path:
        p = (self.root / validate_key(key)).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("object key escapes storage root")
        return p

    def write(self, key: str, parts: Iterable[bytes]) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as fh:
                for part in parts:
                    fh.write(part)
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    def read_range(self, key: str, start: int, length: int) -> bytes:
        with open(self._path(key), "rb") as fh:
            fh.seek(start)
            return fh.read(length)

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink()
        except FileNotFoundError:
            pass

    def delete_prefix(self, prefix: str) -> int:
        base = self._path(prefix.rstrip("/"))
        if not base.exists():
            return 0
        if base.is_file():
            base.unlink()
            return 1
        count = sum(1 for p in base.rglob("*") if p.is_file())
        shutil.rmtree(base)
        return count

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


class S3Backend:
    """Private S3 bucket. Objects are additionally server-side encrypted."""

    def __init__(self, settings: Settings):
        import boto3

        if not settings.s3_bucket:
            raise RuntimeError("AS_S3_BUCKET is not configured")
        self.bucket = settings.s3_bucket
        self.prefix = settings.s3_prefix
        self.client = boto3.client("s3", region_name=settings.s3_region, endpoint_url=settings.s3_endpoint_url)

    def _k(self, key: str) -> str:
        return self.prefix + validate_key(key)

    def write(self, key: str, parts: Iterable[bytes]) -> None:
        body = b"".join(parts)
        self.client.put_object(
            Bucket=self.bucket,
            Key=self._k(key),
            Body=body,
            ServerSideEncryption="AES256",
            ContentType="application/octet-stream",
            ACL="private",
        )

    def read_range(self, key: str, start: int, length: int) -> bytes:
        if length <= 0:
            return b""
        resp = self.client.get_object(Bucket=self.bucket, Key=self._k(key), Range=f"bytes={start}-{start + length - 1}")
        return resp["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._k(key))

    def delete_prefix(self, prefix: str) -> int:
        count = 0
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self._k(prefix)):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": objs})
                count += len(objs)
        return count

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=self._k(key))
            return True
        except ClientError:
            return False


class ObjectStore:
    """Encrypting facade over a raw backend."""

    def __init__(self, backend: RawBackend, cipher: ObjectCipher):
        self.backend = backend
        self.cipher = cipher

    # -- writing -------------------------------------------------------------
    def put_file(self, key: str, path: Path, chunk_size: int = DEFAULT_CHUNK) -> int:
        size = path.stat().st_size
        with open(path, "rb") as fh:
            self.backend.write(key, self.cipher.encrypt_stream(key, fh, size, chunk_size))
        return size

    def put_bytes(self, key: str, data: bytes) -> int:
        import io

        self.backend.write(key, self.cipher.encrypt_stream(key, io.BytesIO(data), len(data)))
        return len(data)

    # -- reading -------------------------------------------------------------
    def header(self, key: str) -> tuple[Header, bytes]:
        raw = self.backend.read_range(key, 0, HEADER_SIZE)
        return Header.unpack(raw), raw

    def size(self, key: str) -> int:
        return self.header(key)[0].plaintext_size

    def iter_range(self, key: str, start: int = 0, end: int | None = None) -> Iterator[bytes]:
        """Yield plaintext bytes in [start, end) decrypting only the needed chunks."""
        header, raw = self.header(key)
        size = header.plaintext_size
        end = size if end is None else min(end, size)
        if start >= end:
            return
        cs = header.chunk_size
        first, last = start // cs, (end - 1) // cs
        for i in range(first, last + 1):
            plain_len = header.chunk_plain_len(i)
            blob = self.backend.read_range(key, header.chunk_offset(i), plain_len + TAG_SIZE)
            plain = self.cipher.decrypt_chunk(key, raw, i, blob)
            lo = start - i * cs if i == first else 0
            hi = end - i * cs if i == last else plain_len
            yield plain[lo:hi]

    def get_bytes(self, key: str) -> bytes:
        return b"".join(self.iter_range(key))

    def download_to(self, key: str, path: Path) -> Path:
        with open(path, "wb") as fh:
            os.chmod(path, 0o600)
            for part in self.iter_range(key):
                fh.write(part)
        return path

    def exists(self, key: str) -> bool:
        return self.backend.exists(key)

    def delete(self, key: str) -> None:
        self.backend.delete(key)

    def delete_prefix(self, prefix: str) -> int:
        return self.backend.delete_prefix(prefix)


@lru_cache
def get_store() -> ObjectStore:
    settings = get_settings()
    backend: RawBackend
    if settings.storage_backend == "s3":
        backend = S3Backend(settings)
    else:
        backend = LocalBackend(settings.storage_dir)
    return ObjectStore(backend, ObjectCipher(settings.encryption_key_bytes()))


def secure_tempdir(prefix: str = "job-") -> Path:
    """Create a private (0700) temporary directory under the configured temp root."""
    root = get_settings().temp_dir
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    return Path(tempfile.mkdtemp(prefix=prefix, dir=root))
