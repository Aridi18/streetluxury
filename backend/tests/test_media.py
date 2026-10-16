import numpy as np
import pytest
from conftest import speech_like, write_audio

from app import media

CASES = [
    ("a.wav", ["-c:a", "pcm_s16le"], "wav", True),
    ("a.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"], "mp3", True),
    ("a.m4a", ["-c:a", "aac", "-b:a", "64k"], "m4a", True),
    ("a.ogg", ["-c:a", "libopus", "-b:a", "24k"], "ogg", False),
    ("a.flac", ["-c:a", "flac"], "flac", False),
    ("a.webm", ["-c:a", "libopus", "-b:a", "32k"], "webm", False),
    ("a.aac", ["-c:a", "aac", "-b:a", "64k", "-f", "adts"], "aac", False),
]


@pytest.mark.parametrize("name,codec,fmt,playable", CASES)
def test_sniff_probe_decode(tmp_path, name, codec, fmt, playable):
    x = speech_like(3.0)
    path = write_audio(tmp_path / name, x, codec=codec)
    sniffed = media.sniff_format(path.read_bytes()[:64])
    assert sniffed is not None and sniffed.name == fmt
    info = media.probe(path, sniffed)
    assert abs(info.duration - 3.0) < 0.15
    assert info.browser_playable is playable
    y = media.decode(path, sniffed, 16000)
    assert abs(len(y) / 16000 - 3.0) < 0.15
    assert np.isfinite(y).all() and np.abs(y).max() > 0.01


@pytest.mark.parametrize(
    "head",
    [
        b"<html><body>not audio</body></html>",
        b"#EXTM3U\n#EXTINF:10,\nfile:///etc/passwd\n",
        b"\x00" * 64,
        b"PK\x03\x04" + b"\x00" * 60,
    ],
)
def test_rejects_non_audio(head):
    assert media.sniff_format(head) is None


def test_playlist_disguised_as_mp3_cannot_read_files(tmp_path):
    # A playlist renamed to .mp3 with an ID3-looking header: the forced demuxer and
    # protocol whitelist must stop FFmpeg from following the referenced file.
    secret = tmp_path / "secret.wav"
    write_audio(secret, speech_like(1.0))
    bad = tmp_path / "evil.mp3"
    bad.write_bytes(b"ID3\x03\x00\x00\x00\x00\x00\x00" + f"\n#EXTM3U\n{secret}\n".encode())
    fmt = media.sniff_format(bad.read_bytes()[:64])
    with pytest.raises(media.MediaError):
        media.probe(bad, fmt)
        media.decode(bad, fmt, 16000)


def test_video_is_rejected(tmp_path):
    import subprocess

    path = tmp_path / "v.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x64:rate=5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "1",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )
    fmt = media.sniff_format(path.read_bytes()[:64])
    with pytest.raises(media.MediaError, match="contains video"):
        media.probe(path, fmt)
