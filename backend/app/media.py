"""Container sniffing, probing and decoding.

Uploaded files are untrusted. Before FFmpeg ever sees a file we identify its
container from magic bytes and then force that demuxer (``-f``) together with a
``file``-only protocol whitelist. This prevents playlist / concat style inputs
from making FFmpeg read other local files or reach the network.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


class MediaError(Exception):
    """A user-facing problem with an uploaded file."""


@dataclass(frozen=True)
class ContainerFormat:
    name: str  # short name used in the UI and DB
    demuxer: str  # FFmpeg demuxer forced with -f
    label: str
    mime: str


FORMATS = {
    "wav": ContainerFormat("wav", "wav", "WAV", "audio/wav"),
    "mp3": ContainerFormat("mp3", "mp3", "MP3", "audio/mpeg"),
    "m4a": ContainerFormat("m4a", "mov,mp4,m4a,3gp,3g2,mj2", "M4A / MP4 audio", "audio/mp4"),
    "aac": ContainerFormat("aac", "aac", "AAC (ADTS)", "audio/aac"),
    "ogg": ContainerFormat("ogg", "ogg", "Ogg (Opus/Vorbis)", "audio/ogg"),
    "flac": ContainerFormat("flac", "flac", "FLAC", "audio/flac"),
    "webm": ContainerFormat("webm", "matroska,webm", "WebM / Matroska audio", "audio/webm"),
    "amr": ContainerFormat("amr", "amr", "AMR", "audio/amr"),
    "aiff": ContainerFormat("aiff", "aiff", "AIFF", "audio/aiff"),
    "caf": ContainerFormat("caf", "caf", "Core Audio (CAF)", "audio/x-caf"),
}

SUPPORTED_DESCRIPTION = "WAV, MP3, M4A/AAC, OGG/Opus, FLAC, WebM (browser recordings), AMR, AIFF and CAF"

# FFmpeg codec names that every major browser can play inside the given container.
_BROWSER_SAFE = {
    "wav": {"pcm_s16le", "pcm_s24le", "pcm_f32le", "pcm_u8"},
    "mp3": {"mp3"},
    "m4a": {"aac", "mp3"},
}


def sniff_format(head: bytes) -> ContainerFormat | None:
    """Identify the container from its first bytes. Returns None if unknown."""
    if len(head) < 12:
        return None
    if head[:4] in (b"RIFF", b"RF64") and head[8:12] == b"WAVE":
        return FORMATS["wav"]
    if head[:4] == b"fLaC":
        return FORMATS["flac"]
    if head[:4] == b"OggS":
        return FORMATS["ogg"]
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return FORMATS["webm"]
    if head[4:8] == b"ftyp":
        return FORMATS["m4a"]
    if head[:5] == b"#!AMR":
        return FORMATS["amr"]
    if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return FORMATS["aiff"]
    if head[:4] == b"caff":
        return FORMATS["caf"]
    if head[:3] == b"ID3":
        # ID3v2 tag: MP3 in practice (ADTS AAC with ID3 is rare but possible).
        return FORMATS["mp3"]
    if head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        layer = (head[1] >> 1) & 0x03
        if (head[1] & 0xF0) == 0xF0 and layer == 0:
            return FORMATS["aac"]  # ADTS
        if layer != 0:
            return FORMATS["mp3"]  # MPEG-1/2 audio frame sync
    return None


def _run(cmd: list[str], timeout: float, input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, input=input_bytes, check=False)
    except subprocess.TimeoutExpired as exc:
        raise MediaError("Processing the file took too long and was stopped.") from exc
    except FileNotFoundError as exc:  # pragma: no cover - deployment problem
        raise RuntimeError(f"{cmd[0]} is not installed on the server") from exc


def _safe_input_args(path: Path, fmt: ContainerFormat) -> list[str]:
    return ["-protocol_whitelist", "file", "-f", fmt.demuxer.split(",")[0], "-i", str(path)]


@dataclass
class ProbeResult:
    format: ContainerFormat
    duration: float
    sample_rate: int
    channels: int
    codec: str
    codec_long: str | None
    bit_rate: int | None
    bits_per_sample: int | None
    sample_fmt: str | None
    channel_layout: str | None
    container_duration: float | None
    stream_duration: float | None
    start_time: float | None
    n_audio_streams: int
    has_video: bool
    format_tags: dict[str, str] = field(default_factory=dict)
    stream_tags: dict[str, str] = field(default_factory=dict)
    format_name: str | None = None
    raw_size: int | None = None

    @property
    def browser_playable(self) -> bool:
        return self.codec in _BROWSER_SAFE.get(self.format.name, set())

    def to_dict(self) -> dict:
        return {
            "container": self.format.name,
            "container_label": self.format.label,
            "format_name": self.format_name,
            "codec": self.codec,
            "codec_long": self.codec_long,
            "duration_seconds": self.duration,
            "container_duration_seconds": self.container_duration,
            "stream_duration_seconds": self.stream_duration,
            "start_time_seconds": self.start_time,
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "channel_layout": self.channel_layout,
            "bit_rate": self.bit_rate,
            "bits_per_sample": self.bits_per_sample,
            "sample_fmt": self.sample_fmt,
            "audio_streams": self.n_audio_streams,
            "has_video": self.has_video,
            "format_tags": self.format_tags,
            "stream_tags": self.stream_tags,
            "size_bytes": self.raw_size,
        }


def _f(v) -> float | None:
    try:
        x = float(v)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _i(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _clean_tags(tags: dict | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (tags or {}).items():
        if isinstance(v, (str, int, float)):
            out[str(k)[:80]] = str(v)[:500]
    return out


def probe(path: Path, fmt: ContainerFormat) -> ProbeResult:
    cmd = [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
    cmd += _safe_input_args(path, fmt)
    proc = _run(cmd, timeout=60)
    if proc.returncode != 0:
        raise MediaError(f"The file looks like {fmt.label} but could not be read. It may be corrupted or truncated.")
    try:
        info = json.loads(proc.stdout or b"{}")
    except json.JSONDecodeError as exc:
        raise MediaError("Could not read the file's structure.") from exc
    streams = info.get("streams", [])
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    video = [
        s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")
    ]
    if not audio:
        raise MediaError("The file does not contain an audio stream.")
    if video:
        raise MediaError("The file contains video. Upload the audio track only (for example, export it as M4A or WAV).")
    a = audio[0]
    fmt_info = info.get("format", {})
    container_duration = _f(fmt_info.get("duration"))
    stream_duration = _f(a.get("duration"))
    duration = stream_duration or container_duration
    sr = _i(a.get("sample_rate"))
    ch = _i(a.get("channels"))
    if not sr or not ch:
        raise MediaError("The audio stream does not declare a sample rate or channel count.")
    return ProbeResult(
        format=fmt,
        duration=duration or 0.0,
        sample_rate=sr,
        channels=ch,
        codec=str(a.get("codec_name") or "unknown"),
        codec_long=a.get("codec_long_name"),
        bit_rate=_i(a.get("bit_rate")) or _i(fmt_info.get("bit_rate")),
        bits_per_sample=_i(a.get("bits_per_raw_sample")) or _i(a.get("bits_per_sample")) or None,
        sample_fmt=a.get("sample_fmt"),
        channel_layout=a.get("channel_layout"),
        container_duration=container_duration,
        stream_duration=stream_duration,
        start_time=_f(a.get("start_time")),
        n_audio_streams=len(audio),
        has_video=bool(video),
        format_tags=_clean_tags(fmt_info.get("tags")),
        stream_tags=_clean_tags(a.get("tags")),
        format_name=fmt_info.get("format_name"),
        raw_size=_i(fmt_info.get("size")),
    )


@lru_cache
def _resampler_filter() -> str:
    """Use the SoX resampler when FFmpeg was built with it (higher quality)."""
    try:
        out = subprocess.run([FFMPEG, "-hide_banner", "-buildconf"], capture_output=True, timeout=10)
        if b"libsoxr" in out.stdout:
            return "aresample=resampler=soxr:precision=28"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "aresample=filter_size=64"


def ffmpeg_version() -> str:
    try:
        out = subprocess.run([FFMPEG, "-version"], capture_output=True, timeout=10)
        return out.stdout.decode("utf-8", "replace").splitlines()[0]
    except (OSError, subprocess.TimeoutExpired, IndexError):
        return "unavailable"


def analysis_sample_rate(native_sr: int) -> int:
    """Analyse at the native rate (so bandwidth evidence is preserved), capped at 48 kHz."""
    return int(min(max(native_sr, 8000), 48000))


def decode(path: Path, fmt: ContainerFormat, sample_rate: int, channels: int = 1, timeout: float = 600) -> np.ndarray:
    """Decode the first audio stream to float32 PCM. Returns shape (n,) for mono."""
    cmd = [FFMPEG, "-nostdin", "-hide_banner", "-v", "error"]
    cmd += _safe_input_args(path, fmt)
    cmd += [
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "-af",
        _resampler_filter(),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "pipe:1",
    ]
    proc = _run(cmd, timeout=timeout)
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
        raise MediaError(f"The audio could not be decoded ({msg[0][:160]}).")
    pcm = np.frombuffer(proc.stdout, dtype="<f4")
    if channels > 1:
        pcm = pcm[: len(pcm) - len(pcm) % channels].reshape(-1, channels)
    return np.ascontiguousarray(pcm, dtype=np.float32)


def transcode_flac(path: Path, fmt: ContainerFormat, out: Path, timeout: float = 600) -> Path:
    """Create a lossless FLAC playback copy for browsers that cannot play the original."""
    cmd = [FFMPEG, "-nostdin", "-hide_banner", "-v", "error", "-y"]
    cmd += _safe_input_args(path, fmt)
    cmd += ["-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-c:a", "flac", "-sample_fmt", "s16", str(out)]
    proc = _run(cmd, timeout=timeout)
    if proc.returncode != 0:
        raise MediaError("Could not create a playback copy of the audio.")
    return out
