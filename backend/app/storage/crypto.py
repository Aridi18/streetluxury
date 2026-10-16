"""Chunked authenticated encryption for stored objects.

Format (all integers big-endian)::

    header  = b"ASE1" | key_id:u8 | chunk_size:u32 | plaintext_size:u64 | nonce_prefix:8B
    chunk_i = AES-256-GCM(key_obj, nonce = nonce_prefix | i:u32,
                          aad = header | i:u32 | is_last:u8)  -> ciphertext | 16-byte tag

``key_obj`` is derived per object with HKDF-SHA256 from the master key and the
object key, so a nonce collision across objects cannot occur. Each chunk is
authenticated separately, which allows HTTP range requests to decrypt only the
chunks they touch, while the chunk index and last-chunk flag in the AAD prevent
reordering and truncation.
"""

from __future__ import annotations

import os
import struct
from collections.abc import Iterator
from dataclasses import dataclass
from typing import BinaryIO

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b"ASE1"
HEADER_FMT = ">4sBIQ8s"
HEADER_SIZE = struct.calcsize(HEADER_FMT)  # 25 bytes
TAG_SIZE = 16
DEFAULT_CHUNK = 64 * 1024


class DecryptionError(Exception):
    pass


@dataclass(frozen=True)
class Header:
    key_id: int
    chunk_size: int
    plaintext_size: int
    nonce_prefix: bytes

    def pack(self) -> bytes:
        return struct.pack(HEADER_FMT, MAGIC, self.key_id, self.chunk_size, self.plaintext_size, self.nonce_prefix)

    @classmethod
    def unpack(cls, raw: bytes) -> Header:
        if len(raw) < HEADER_SIZE:
            raise DecryptionError("truncated header")
        magic, key_id, chunk_size, size, prefix = struct.unpack(HEADER_FMT, raw[:HEADER_SIZE])
        if magic != MAGIC:
            raise DecryptionError("not an Audio Sentinel encrypted object")
        if chunk_size <= 0 or chunk_size > 16 * 1024 * 1024:
            raise DecryptionError("invalid chunk size")
        return cls(key_id, chunk_size, size, prefix)

    @property
    def n_chunks(self) -> int:
        if self.plaintext_size == 0:
            return 1
        return (self.plaintext_size + self.chunk_size - 1) // self.chunk_size

    def chunk_plain_len(self, i: int) -> int:
        if self.plaintext_size == 0:
            return 0
        if i < self.n_chunks - 1:
            return self.chunk_size
        return self.plaintext_size - self.chunk_size * (self.n_chunks - 1)

    def chunk_offset(self, i: int) -> int:
        return HEADER_SIZE + i * (self.chunk_size + TAG_SIZE)

    @property
    def ciphertext_size(self) -> int:
        return HEADER_SIZE + self.plaintext_size + self.n_chunks * TAG_SIZE


class ObjectCipher:
    def __init__(self, master_key: bytes, key_id: int = 1):
        if len(master_key) != 32:
            raise ValueError("master key must be 32 bytes")
        self._master = master_key
        self.key_id = key_id

    def _object_key(self, object_key: str) -> AESGCM:
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=b"audio-sentinel/object/v1/" + object_key.encode("utf-8"),
        )
        return AESGCM(hkdf.derive(self._master))

    @staticmethod
    def _nonce(prefix: bytes, i: int) -> bytes:
        return prefix + struct.pack(">I", i)

    @staticmethod
    def _aad(header_raw: bytes, i: int, last: bool) -> bytes:
        return header_raw + struct.pack(">IB", i, 1 if last else 0)

    def encrypt_stream(
        self, object_key: str, src: BinaryIO, plaintext_size: int, chunk_size: int = DEFAULT_CHUNK
    ) -> Iterator[bytes]:
        """Yield the encrypted object piece by piece (header first)."""
        header = Header(self.key_id, chunk_size, plaintext_size, os.urandom(8))
        raw = header.pack()
        aead = self._object_key(object_key)
        yield raw
        n = header.n_chunks
        for i in range(n):
            want = header.chunk_plain_len(i)
            buf = _read_exact(src, want)
            if len(buf) != want:
                raise ValueError("source shorter than declared plaintext size")
            yield aead.encrypt(self._nonce(header.nonce_prefix, i), buf, self._aad(raw, i, i == n - 1))

    def encrypt_bytes(self, object_key: str, data: bytes, chunk_size: int = DEFAULT_CHUNK) -> bytes:
        import io

        return b"".join(self.encrypt_stream(object_key, io.BytesIO(data), len(data), chunk_size))

    def decrypt_chunk(self, object_key: str, header_raw: bytes, i: int, blob: bytes) -> bytes:
        header = Header.unpack(header_raw)
        if header.key_id != self.key_id:
            raise DecryptionError(f"object encrypted with unknown key id {header.key_id}")
        aead = self._object_key(object_key)
        try:
            return aead.decrypt(
                self._nonce(header.nonce_prefix, i),
                blob,
                self._aad(header_raw[:HEADER_SIZE], i, i == header.n_chunks - 1),
            )
        except Exception as exc:  # cryptography raises InvalidTag
            raise DecryptionError("authentication failed; object corrupted or tampered") from exc


def _read_exact(src: BinaryIO, n: int) -> bytes:
    parts: list[bytes] = []
    remaining = n
    while remaining > 0:
        b = src.read(remaining)
        if not b:
            break
        parts.append(b)
        remaining -= len(b)
    return b"".join(parts)
