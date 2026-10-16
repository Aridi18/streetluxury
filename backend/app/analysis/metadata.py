"""File-level metadata and integrity checks.

Metadata is weak evidence: messaging apps strip it, converters rewrite it and
anyone can edit it. Findings here are leads for further inquiry, not proof.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

EDITOR_PATTERNS = [
    (r"audacity", "Audacity"),
    (r"adobe audition|audition", "Adobe Audition"),
    (r"premiere", "Adobe Premiere"),
    (r"garageband", "GarageBand"),
    (r"logic pro", "Logic Pro"),
    (r"sound ?forge", "Sound Forge"),
    (r"wavepad", "WavePad"),
    (r"ocenaudio", "ocenaudio"),
    (r"reaper", "REAPER"),
    (r"pro ?tools", "Pro Tools"),
    (r"fl studio", "FL Studio"),
    (r"ableton", "Ableton Live"),
    (r"capcut", "CapCut"),
    (r"izotope|\brx\b", "iZotope RX"),
    (r"descript", "Descript"),
    (r"goldwave", "GoldWave"),
    (r"cubase|nuendo", "Steinberg Cubase/Nuendo"),
]
AI_VOICE_PATTERNS = [
    (r"elevenlabs|eleven labs", "ElevenLabs"),
    (r"play\.ht|playht", "PlayHT"),
    (r"\bresemble(\.ai| ai)\b", "Resemble AI"),
    (r"\bmurf\b", "Murf"),
    (r"speechify", "Speechify"),
    (r"wellsaid", "WellSaid Labs"),
    (r"overdub", "Descript Overdub"),
    (r"voicemod", "Voicemod"),
    (r"\brvc\b|retrieval.based voice", "RVC voice conversion"),
    (r"so-vits|sovits", "so-vits-svc"),
    (r"tortoise", "Tortoise TTS"),
    (r"coqui|xtts", "Coqui / XTTS"),
    (r"\bbark\b", "Bark"),
    (r"text.to.speech|\btts\b", "a text-to-speech tool"),
]
CONVERTER_PATTERNS = [
    (r"^lavf|lavc|ffmpeg", "FFmpeg (libavformat)"),
    (r"lame", "LAME MP3 encoder"),
    (r"itunes", "Apple iTunes"),
    (r"sox\b", "SoX"),
]


def _tags_text(media: dict) -> list[tuple[str, str]]:
    tags = {**(media.get("format_tags") or {}), **(media.get("stream_tags") or {})}
    return [(k, v) for k, v in tags.items() if v]


def _finding(fid: str, severity: str, title: str, detail: str, **extra: Any) -> dict:
    return {"id": fid, "severity": severity, "title": title, "detail": detail, **extra}


def analyse(
    media: dict,
    *,
    decoded_duration: float,
    size_bytes: int,
    uploaded_at: datetime | None,
    effective_bandwidth_hz: float | None,
) -> dict:
    findings: list[dict] = []
    tags = _tags_text(media)

    for key, value in tags:
        low = value.lower()
        for pat, name in AI_VOICE_PATTERNS:
            if re.search(pat, low):
                findings.append(
                    _finding(
                        "metadata_ai_tool",
                        "warning",
                        f"Metadata mentions {name}",
                        f"The tag '{key}' contains '{value[:120]}'. This names an AI voice or speech "
                        "synthesis tool. Metadata can be edited, so treat this as a lead to verify.",
                        tag=key,
                    )
                )
                break
        for pat, name in EDITOR_PATTERNS:
            if re.search(pat, low):
                findings.append(
                    _finding(
                        "metadata_editor",
                        "notice",
                        f"Written by audio editing software ({name})",
                        f"The tag '{key}' indicates the file was last saved by {name}. This shows the "
                        "file passed through an editor; it does not show what, if anything, was changed.",
                        tag=key,
                    )
                )
                break
        for pat, name in CONVERTER_PATTERNS:
            if re.search(pat, low):
                findings.append(
                    _finding(
                        "metadata_converter",
                        "info",
                        f"Encoded or remuxed by {name}",
                        f"The tag '{key}' ('{value[:80]}') shows the file was produced or converted by "
                        f"{name}. Conversion is common (exports, messaging apps) and is not itself evidence "
                        "of editing, but it means this is probably not the original device file.",
                        tag=key,
                    )
                )
                break

    # Duration consistency between container, stream and decoded samples.
    cd = media.get("container_duration_seconds")
    sd = media.get("stream_duration_seconds")
    for label, d in (("container", cd), ("stream", sd)):
        if d and decoded_duration > 0:
            diff = abs(d - decoded_duration)
            if diff > max(0.15, 0.02 * decoded_duration):
                findings.append(
                    _finding(
                        f"duration_mismatch_{label}",
                        "notice",
                        f"Declared {label} duration differs from decoded audio",
                        f"The {label} declares {d:.2f} s but {decoded_duration:.2f} s of audio was decoded "
                        f"(difference {diff:.2f} s). This can result from truncation, a damaged file, "
                        "editing without updating headers, or encoder padding.",
                    )
                )
    start = media.get("start_time_seconds")
    if start and start > 0.1:
        findings.append(
            _finding(
                "start_offset",
                "info",
                "Audio stream starts late",
                f"The audio stream's first timestamp is {start:.2f} s, which is common for files "
                "trimmed or remuxed from a longer recording.",
            )
        )

    # Bit rate consistency (constant bit rate files).
    br = media.get("bit_rate")
    if br and decoded_duration > 1 and size_bytes:
        measured = size_bytes * 8 / decoded_duration
        if measured > 0 and abs(measured - br) / measured > 0.5 and media.get("codec") in {"mp3", "aac"}:
            findings.append(
                _finding(
                    "bitrate_mismatch",
                    "info",
                    "Declared bit rate differs from file size",
                    f"Declared {br / 1000:.0f} kbit/s, measured {measured / 1000:.0f} kbit/s from the file "
                    "size. Large differences can mean variable bit rate, embedded artwork, or appended data.",
                )
            )

    # Creation timestamps.
    for key, value in tags:
        if "creation_time" in key or key.lower() in {"date", "date_recorded", "icrd"}:
            dt = _parse_dt(value)
            if dt and uploaded_at and dt > uploaded_at.astimezone(UTC):
                findings.append(
                    _finding(
                        "creation_in_future",
                        "notice",
                        "Creation time is later than the upload",
                        f"'{key}' = {value}, which is after the file was uploaded. The device clock "
                        "may be wrong, or the metadata was altered.",
                    )
                )

    # Bandwidth vs. sample rate (upsampled narrowband audio).
    sr = media.get("sample_rate") or 0
    if effective_bandwidth_hz and sr:
        nyq = sr / 2
        if effective_bandwidth_hz < 0.6 * nyq:
            findings.append(
                _finding(
                    "upsampled",
                    "info",
                    "Audio content is band-limited below the file's sample rate",
                    f"The file is sampled at {sr} Hz (bandwidth up to {nyq / 1000:.1f} kHz) but the audio "
                    f"contains little energy above {effective_bandwidth_hz / 1000:.1f} kHz. It was probably "
                    "recorded or transmitted at a lower quality (for example a phone call) and later converted.",
                )
            )

    if media.get("audio_streams", 1) > 1:
        findings.append(
            _finding(
                "multiple_streams",
                "notice",
                "Multiple audio streams",
                f"The file contains {media['audio_streams']} audio streams; only the first was analysed.",
            )
        )

    for key, value in tags:
        if re.search(r"voicememos|voice memos", value.lower()):
            findings.append(
                _finding(
                    "device_recorder",
                    "info",
                    "Recorded with Apple Voice Memos",
                    f"The tag '{key}' ('{value[:120]}') names the iOS/macOS Voice Memos recorder, which "
                    "is consistent with an original device recording (metadata can still be edited).",
                )
            )
            break

    messaging = _messaging_hint(media)
    if messaging:
        findings.append(_finding("messaging_app_format", "info", "Typical messaging-app format", messaging))

    summary = {
        "container": media.get("container_label") or media.get("container"),
        "codec": media.get("codec"),
        "codec_long": media.get("codec_long"),
        "sample_rate": media.get("sample_rate"),
        "channels": media.get("channels"),
        "channel_layout": media.get("channel_layout"),
        "bit_rate": media.get("bit_rate"),
        "bits_per_sample": media.get("bits_per_sample"),
        "duration_seconds": decoded_duration,
        "container_duration_seconds": cd,
        "size_bytes": size_bytes,
        "tags": dict(tags),
        "effective_bandwidth_hz": effective_bandwidth_hz,
    }
    return {
        "summary": summary,
        "findings": findings,
        "note": (
            "Metadata can be missing, rewritten by converters and messaging apps, or deliberately "
            "edited. Its absence is normal and its presence is not proof of origin."
        ),
    }


def _messaging_hint(media: dict) -> str | None:
    codec = media.get("codec")
    container = media.get("container")
    sr = media.get("sample_rate")
    ch = media.get("channels")
    if container == "ogg" and codec == "opus" and ch == 1:
        return (
            "Mono Opus in an Ogg container is the format used by WhatsApp, Telegram and Signal voice "
            "notes. These apps re-encode audio and remove most metadata, so the original device "
            "recording is not available from this file."
        )
    if container == "m4a" and codec == "aac" and ch == 1 and sr in (16000, 22050, 24000):
        return "Low-rate mono AAC is typical of app-exported voice messages, which are re-encoded."
    if container == "amr":
        return "AMR is a narrowband phone/voice-message codec; audio above 4 kHz is not represented."
    if container == "webm" and codec == "opus":
        return "WebM/Opus is produced by browser recorders (MediaRecorder)."
    return None


def _parse_dt(v: str) -> datetime | None:
    v = v.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None
