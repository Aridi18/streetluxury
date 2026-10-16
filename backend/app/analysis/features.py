"""Shared frame-level features and voice activity detection (16 kHz, 10 ms hop)."""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
from scipy.fft import dct

from . import dsp

SR16 = 16000
HOP = 160  # 10 ms
WIN = 400  # 25 ms
NFFT = 512
N_MELS = 40
FRAME_S = HOP / SR16

SILENCE_DB = -110.0  # frames at or below this are treated as digital silence


@dataclass
class Frames:
    """Frame features on the 16 kHz analysis signal."""

    energy_db: np.ndarray  # (n,)
    mel_db: np.ndarray  # (n, N_MELS)
    mfcc: np.ndarray  # (n, 13)
    times: np.ndarray  # (n,) seconds, relative to the analysed signal start

    @property
    def n(self) -> int:
        return int(self.energy_db.size)


@dataclass
class VadResult:
    speech: np.ndarray  # bool (n,)
    background: np.ndarray  # bool (n,) confidently non-speech, non-silent frames
    digital_silence: np.ndarray  # bool (n,)
    floor_db: np.ndarray  # (n,) local noise floor estimate
    segments: list[tuple[float, float]]  # speech segments in seconds

    @property
    def speech_seconds(self) -> float:
        return float(np.sum(self.speech)) * FRAME_S


_MEL_FB: np.ndarray | None = None


def _mel_fb() -> np.ndarray:
    global _MEL_FB
    if _MEL_FB is None:
        _MEL_FB = librosa.filters.mel(sr=SR16, n_fft=NFFT, n_mels=N_MELS, fmin=60.0, fmax=7800.0).astype(np.float32)
    return _MEL_FB


def compute_frames(x16: np.ndarray) -> Frames:
    fb = _mel_fb()
    n = dsp.n_frames(len(x16), HOP)
    mel = np.empty((n, N_MELS), dtype=np.float32)
    for i, p in dsp.power_spectrogram(x16, NFFT, HOP, WIN):
        mel[i : i + len(p)] = p @ fb.T
    mel_db = dsp.db(mel).astype(np.float32)
    energy_db = np.maximum(dsp.frame_rms_db(x16, WIN, HOP), -120.0).astype(np.float32)
    mfcc = dct(mel_db, type=2, axis=1, norm="ortho")[:, :13].astype(np.float32)
    times = (np.arange(n) * HOP / SR16).astype(np.float64)
    return Frames(energy_db=energy_db, mel_db=mel_db, mfcc=mfcc, times=times)


def voice_activity(frames: Frames) -> VadResult:
    """Energy-based VAD against an adaptive (minimum-statistics) noise floor.

    Speech starts 10 dB above the local floor and continues while 6 dB above it
    (hysteresis); short gaps are bridged and very short bursts removed.
    """
    e = frames.energy_db
    n = e.size
    silent = e <= SILENCE_DB
    es = dsp.running_median(e, 3)
    # Ignore digital silence when tracking the floor, otherwise the floor collapses.
    es_for_min = np.where(silent, np.inf, es)
    floor = dsp.running_min(es_for_min, 150)  # 1.5 s
    nonsilent = es[~silent]
    global_floor = float(np.percentile(nonsilent, 10)) if nonsilent.size else SILENCE_DB
    floor = np.where(np.isfinite(floor), floor, global_floor)
    floor = dsp.running_max(floor, 150)
    floor = dsp.moving_average(floor, 50).astype(np.float32)

    hi = (es > floor + 10.0) & (es > -65.0)
    lo = (es > floor + 6.0) & (es > -70.0)
    speech = np.zeros(n, dtype=bool)
    active = False
    for i in range(n):  # hysteresis; n is at most a few hundred thousand frames
        if active:
            active = bool(lo[i])
        else:
            active = bool(hi[i])
        speech[i] = active
    # Bridge gaps shorter than 150 ms and drop bursts shorter than 80 ms.
    for s, t in dsp.bool_runs(~speech):
        if 0 < s and t < n and (t - s) < 15:
            speech[s:t] = True
    for s, t in dsp.bool_runs(speech):
        if (t - s) < 8:
            speech[s:t] = False

    near_speech = dsp.running_max(speech.astype(np.float32), 7) > 0  # +-30 ms guard
    background = (~near_speech) & (~silent) & (es < floor + 6.0)
    segments = [(s * FRAME_S, t * FRAME_S) for s, t in dsp.bool_runs(speech)]
    return VadResult(
        speech=speech,
        background=background,
        digital_silence=silent,
        floor_db=floor,
        segments=segments,
    )
