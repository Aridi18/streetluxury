from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import dsp
from .base import AnalysisCancelled, ProgressFn
from .features import SR16, Frames, VadResult, compute_frames, voice_activity


@dataclass
class AnalysisContext:
    """Everything a detector may read. Times are seconds within the analysed signal;
    ``offset`` converts them to positions in the full recording."""

    x: np.ndarray  # mono, native analysis rate
    sr: int
    x16: np.ndarray
    frames: Frames
    vad: VadResult
    offset: float = 0.0
    media: dict[str, Any] = field(default_factory=dict)
    progress_fn: ProgressFn | None = None
    cancel_check: Any = None
    cache: dict[str, Any] = field(default_factory=dict)

    @property
    def duration(self) -> float:
        return len(self.x) / self.sr

    @property
    def codec(self) -> str:
        return str(self.media.get("codec") or "")

    @property
    def container(self) -> str:
        return str(self.media.get("container") or "")

    def abs_time(self, t: float) -> float:
        return float(t + self.offset)

    def progress(self, stage: str, fraction: float) -> None:
        if self.cancel_check and self.cancel_check():
            raise AnalysisCancelled()
        if self.progress_fn:
            self.progress_fn(stage, fraction)


def build_context(
    x: np.ndarray,
    sr: int,
    *,
    offset: float = 0.0,
    media: dict | None = None,
    progress_fn: ProgressFn | None = None,
    cancel_check=None,
) -> AnalysisContext:
    x = np.nan_to_num(x.astype(np.float32, copy=False))
    x16 = dsp.resample(x, sr, SR16)
    frames = compute_frames(x16)
    vad = voice_activity(frames)
    return AnalysisContext(
        x=x,
        sr=sr,
        x16=x16,
        frames=frames,
        vad=vad,
        offset=offset,
        media=media or {},
        progress_fn=progress_fn,
        cancel_check=cancel_check,
    )
