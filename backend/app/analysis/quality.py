"""Recording quality issues that affect the reliability of the analysis."""

from __future__ import annotations

import numpy as np

from . import dsp
from .context import AnalysisContext
from .features import FRAME_S


def assess(ctx: AnalysisContext, media: dict) -> dict:
    fr, vad = ctx.frames, ctx.vad
    e = fr.energy_db
    speech_s = vad.speech_seconds
    duration = ctx.duration
    bg = vad.background
    noise_floor = float(np.median(e[bg])) if bg.sum() > 20 else float(np.percentile(e, 10))
    speech_level = float(np.percentile(e[vad.speech], 75)) if vad.speech.sum() > 20 else None
    snr = (speech_level - noise_floor) if speech_level is not None else None

    x = ctx.x
    clip = np.abs(x) >= 0.995
    clipped_samples = 0
    if clip.any():
        for a, b in dsp.bool_runs(clip):
            if b - a >= 3:
                clipped_samples += b - a
    clip_ratio = clipped_samples / max(1, len(x))
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    bandwidth = ctx.cache.get("effective_bandwidth_hz")
    bitrate = media.get("bit_rate")
    codec = media.get("codec") or ""
    lossy = codec not in {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8", "flac", "alac"}

    issues: list[dict] = []

    def add(code: str, severity: str, title: str, detail: str, affects: list[str]) -> None:
        issues.append({"code": code, "severity": severity, "title": title, "detail": detail, "affects": affects})

    if duration < 3.0:
        add(
            "very_short",
            "severe",
            "Very short recording",
            f"Only {duration:.1f} s of audio. Most checks need several seconds of context.",
            ["edit", "synthetic"],
        )
    if speech_s < 1.5:
        add(
            "little_speech",
            "severe",
            "Little or no speech detected",
            f"About {speech_s:.1f} s of speech was detected. Synthetic-speech detection needs at least "
            "a few seconds of speech.",
            ["synthetic"],
        )
    elif speech_s < 4.0:
        add(
            "short_speech",
            "warning",
            "Limited speech",
            f"About {speech_s:.1f} s of speech; detector reliability is reduced for short inputs.",
            ["synthetic"],
        )
    if snr is not None and snr < 10:
        add(
            "low_snr",
            "severe" if snr < 6 else "warning",
            "Low signal-to-noise ratio",
            f"Speech is about {snr:.0f} dB above the background. Noise can hide edits and confuse "
            "synthetic-speech models.",
            ["edit", "synthetic"],
        )
    if clip_ratio > 0.001:
        add(
            "clipping",
            "warning" if clip_ratio < 0.01 else "severe",
            "Clipping",
            f"{clip_ratio * 100:.2f}% of samples are clipped (saturated). Distortion affects spectral and "
            "waveform checks.",
            ["edit", "synthetic"],
        )
    if peak < 0.01 and x.size:
        add(
            "very_quiet",
            "warning",
            "Very low level",
            f"Peak level is {20 * np.log10(peak + 1e-12):.0f} dBFS.",
            ["edit", "synthetic"],
        )
    if bandwidth and bandwidth < 4500:
        add(
            "narrowband",
            "warning",
            "Narrowband audio",
            f"Audio content stops around {bandwidth / 1000:.1f} kHz (telephone quality). High-frequency "
            "artefacts used by synthetic-speech detectors are missing.",
            ["synthetic", "edit"],
        )
    if lossy and bitrate and bitrate < 32000:
        add(
            "low_bitrate",
            "warning",
            "Heavy compression",
            f"{codec} at {bitrate / 1000:.0f} kbit/s. Strong compression removes fine detail and can "
            "mask or mimic artefacts.",
            ["edit", "synthetic"],
        )
    elif lossy:
        add(
            "lossy",
            "info",
            "Lossy compression",
            f"The file uses lossy {codec} compression; fine waveform evidence may be degraded.",
            ["edit"],
        )
    if (media.get("sample_rate") or 16000) < 16000:
        add(
            "low_sample_rate",
            "warning",
            "Low sample rate",
            f"{media.get('sample_rate')} Hz sampling limits the frequency range available.",
            ["synthetic", "edit"],
        )
    if media.get("channels", 1) and media.get("channels", 1) > 1:
        add(
            "downmix",
            "info",
            "Multi-channel audio downmixed",
            f"{media.get('channels')} channels were averaged to mono for analysis.",
            ["edit"],
        )
    if vad.digital_silence.mean() > 0.5:
        add(
            "mostly_silent",
            "warning",
            "Mostly digital silence",
            f"{vad.digital_silence.mean() * 100:.0f}% of the audio is digital silence.",
            ["edit", "synthetic"],
        )

    sev_rank = {"info": 0, "warning": 1, "severe": 2}
    worst = max((sev_rank[i["severity"]] for i in issues), default=0)
    return {
        "duration_seconds": duration,
        "speech_seconds": speech_s,
        "speech_ratio": speech_s / duration if duration else 0.0,
        "noise_floor_dbfs": noise_floor,
        "speech_level_dbfs": speech_level,
        "snr_db": snr,
        "clipping_ratio": clip_ratio,
        "peak_dbfs": float(20 * np.log10(peak + 1e-12)),
        "effective_bandwidth_hz": bandwidth,
        "speech_segments": len(vad.segments),
        "background_seconds": float(bg.sum() * FRAME_S),
        "issues": issues,
        "overall": ["good", "fair", "poor"][worst],
        "blocks": {
            "edit": any(i["severity"] == "severe" and "edit" in i["affects"] for i in issues),
            "synthetic": any(i["severity"] == "severe" and "synthetic" in i["affects"] for i in issues),
        },
    }
