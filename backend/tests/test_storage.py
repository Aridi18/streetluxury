import os

import pytest

from app.storage import LocalBackend, ObjectStore, validate_key
from app.storage.crypto import HEADER_SIZE, DecryptionError, ObjectCipher


@pytest.fixture()
def store(tmp_path):
    return ObjectStore(LocalBackend(tmp_path / "objs"), ObjectCipher(os.urandom(32)))


def test_roundtrip_and_ranges(store, tmp_path):
    data = os.urandom(300_000)
    src = tmp_path / "src.bin"
    src.write_bytes(data)
    store.put_file("recordings/abc/original", src)
    assert store.size("recordings/abc/original") == len(data)
    assert store.get_bytes("recordings/abc/original") == data
    for a, b in [(0, 1), (65535, 65537), (100, 200_000), (299_990, 300_000), (131072, 131072 + 65536)]:
        assert b"".join(store.iter_range("recordings/abc/original", a, b)) == data[a:b]


def test_empty_object(store):
    store.put_bytes("x/empty", b"")
    assert store.get_bytes("x/empty") == b""
    assert store.size("x/empty") == 0


def test_ciphertext_does_not_contain_plaintext(store, tmp_path):
    data = b"RIFF" + b"secret speech " * 1000
    store.put_bytes("x/plain", data)
    raw = (tmp_path / "objs" / "x" / "plain").read_bytes()
    assert b"secret speech" not in raw
    assert oct((tmp_path / "objs" / "x" / "plain").stat().st_mode & 0o777) == "0o600"


def test_tampering_is_detected(store, tmp_path):
    store.put_bytes("x/t", os.urandom(200_000))
    path = tmp_path / "objs" / "x" / "t"
    raw = bytearray(path.read_bytes())
    raw[HEADER_SIZE + 70_000] ^= 0x01
    path.write_bytes(bytes(raw))
    with pytest.raises(DecryptionError):
        store.get_bytes("x/t")


def test_truncation_is_detected(store, tmp_path):
    store.put_bytes("x/u", os.urandom(200_000))
    path = tmp_path / "objs" / "x" / "u"
    raw = path.read_bytes()
    # Drop the final chunk but keep the header: the next-to-last chunk is not flagged "last".
    path.write_bytes(raw[: HEADER_SIZE + 3 * (65536 + 16)])
    with pytest.raises(DecryptionError):
        store.get_bytes("x/u")


def test_wrong_key_fails(tmp_path):
    a = ObjectStore(LocalBackend(tmp_path / "o"), ObjectCipher(os.urandom(32)))
    b = ObjectStore(LocalBackend(tmp_path / "o"), ObjectCipher(os.urandom(32)))
    a.put_bytes("k/1", b"hello world" * 100)
    with pytest.raises(DecryptionError):
        b.get_bytes("k/1")


def test_objects_bound_to_their_key(store, tmp_path):
    """An encrypted object copied under another key must not decrypt (per-object HKDF keys)."""
    store.put_bytes("k/a", b"A" * 1000)
    (tmp_path / "objs" / "k" / "b").write_bytes((tmp_path / "objs" / "k" / "a").read_bytes())
    with pytest.raises(DecryptionError):
        store.get_bytes("k/b")


@pytest.mark.parametrize("bad", ["../etc/passwd", "/abs", "a/../../b", "", "a\\b", "a\x00"])
def test_key_validation(bad):
    with pytest.raises(ValueError):
        validate_key(bad)


def test_delete_prefix(store):
    store.put_bytes("recordings/r1/original", b"1")
    store.put_bytes("recordings/r1/spectrogram/0.png", b"2")
    store.put_bytes("recordings/r2/original", b"3")
    assert store.delete_prefix("recordings/r1") == 2
    assert not store.exists("recordings/r1/original")
    assert store.exists("recordings/r2/original")


def test_s3_backend_with_moto(monkeypatch):
    moto = pytest.importorskip("moto")
    import boto3

    from app.config import Settings
    from app.storage import S3Backend

    with moto.mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="as-test")
        s = Settings(storage_backend="s3", s3_bucket="as-test", s3_region="us-east-1")
        store = ObjectStore(S3Backend(s), ObjectCipher(os.urandom(32)))
        data = os.urandom(150_000)
        store.put_bytes("recordings/z/original", data)
        assert store.get_bytes("recordings/z/original") == data
        assert b"".join(store.iter_range("recordings/z/original", 70_000, 70_010)) == data[70_000:70_010]
        assert store.delete_prefix("recordings/z") == 1
        assert not store.exists("recordings/z/original")
