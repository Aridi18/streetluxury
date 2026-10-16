"""Shared helpers for the Audio Sentinel evaluation suite.

Run scripts with the backend's virtual environment from the repository root, e.g.::

    backend/.venv/bin/python evaluation/synthetic_eval.py --itw /data/itw
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
CALIBRATION = BACKEND / "calibration"
RESULTS = ROOT / "evaluation" / "results"
WORK = ROOT / "evaluation" / "work"
sys.path.insert(0, str(BACKEND))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def split_of(group: str, salt: str = "audio-sentinel-v1") -> str:
    """Deterministic group-disjoint split (e.g. by speaker): 'calibration' or 'test'."""
    h = int(hashlib.sha256(f"{salt}:{group}".encode()).hexdigest(), 16)
    return "calibration" if h % 2 == 0 else "test"


# --- Metrics -------------------------------------------------------------------------


def roc_points(y: np.ndarray, s: np.ndarray):
    """y=1 positive (synthetic/edited). Returns fpr, tpr, thresholds (score >= thr => positive)."""
    order = np.argsort(-s, kind="mergesort")
    s, y = s[order], y[order]
    tps = np.cumsum(y)
    fps = np.cumsum(1 - y)
    distinct = np.r_[np.flatnonzero(np.diff(s)), len(s) - 1]
    tpr = np.r_[0.0, tps[distinct] / max(1, y.sum())]
    fpr = np.r_[0.0, fps[distinct] / max(1, (1 - y).sum())]
    thr = np.r_[np.inf, s[distinct]]
    return fpr, tpr, thr


def auc(y: np.ndarray, s: np.ndarray) -> float:
    fpr, tpr, _ = roc_points(y, s)
    return float(np.trapezoid(tpr, fpr))


def eer(y: np.ndarray, s: np.ndarray) -> tuple[float, float]:
    """Equal error rate and the score threshold at which it occurs."""
    fpr, tpr, thr = roc_points(y, s)
    fnr = 1 - tpr
    i = int(np.argmin(np.abs(fnr - fpr)))
    return float((fpr[i] + fnr[i]) / 2), float(thr[i])


def rates_at(y: np.ndarray, s: np.ndarray, thr: float) -> dict:
    pred = s >= thr
    pos, neg = y == 1, y == 0
    tp, fp = int((pred & pos).sum()), int((pred & neg).sum())
    fn, tn = int((~pred & pos).sum()), int((~pred & neg).sum())
    return {
        "tpr": tp / max(1, tp + fn),
        "fpr": fp / max(1, fp + tn),
        "fnr": fn / max(1, tp + fn),
        "precision": tp / max(1, tp + fp),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def fit_platt(s: np.ndarray, y: np.ndarray, balanced: bool = True, iters: int = 100) -> tuple[float, float]:
    """Logistic calibration P(y=1|s) = sigmoid(a*s + b) by Newton's method.

    With ``balanced`` the classes are weighted equally, so the calibrated value
    corresponds to equal prior odds (a likelihood-ratio interpretation) rather
    than the class mix of the calibration set.
    """
    s = s.astype(np.float64)
    y = y.astype(np.float64)
    w = np.ones_like(s)
    if balanced:
        n1, n0 = y.sum(), (1 - y).sum()
        w = np.where(y == 1, 0.5 / max(n1, 1), 0.5 / max(n0, 1)) * len(y)
    # Platt's target smoothing to avoid infinite slopes on separable data.
    n1, n0 = y.sum(), (1 - y).sum()
    t = np.where(y == 1, (n1 + 1) / (n1 + 2), 1 / (n0 + 2))
    a, b = 1.0, 0.0
    X = np.stack([s, np.ones_like(s)], axis=1)
    for _ in range(iters):
        z = np.clip(a * s + b, -40, 40)
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (w * (p - t))
        H = (X * (w * p * (1 - p))[:, None]).T @ X + np.eye(2) * 1e-9
        step = np.linalg.solve(H, g)
        a, b = a - step[0], b - step[1]
        if np.abs(step).max() < 1e-10:
            break
    return float(a), float(b)


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -50, 50)))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        fh.write("\n")


def update_summary(section: str, data: dict) -> None:
    path = CALIBRATION / "evaluation_summary.json"
    try:
        summary = json.loads(path.read_text())
    except FileNotFoundError:
        summary = {}
    summary[section] = data
    summary["generated_at"] = now()
    write_json(path, summary)


# --- Degradation conditions (codec / channel robustness) -------------------------------


def _ffmpeg_roundtrip(x: np.ndarray, sr: int, enc: list[str], fmt: str, demux: str | None = None) -> np.ndarray:
    enc_cmd = ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", *enc, "-f", fmt, "pipe:1"]
    data = subprocess.run(enc_cmd, input=x.astype("<f4").tobytes(), capture_output=True, check=True).stdout
    dec_cmd = ["ffmpeg", "-v", "error", "-f", demux or fmt, "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"]
    out = subprocess.run(dec_cmd, input=data, capture_output=True, check=True).stdout
    y = np.frombuffer(out, dtype="<f4").copy()
    return y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


def degrade(x: np.ndarray, sr: int, condition: str, rng: np.random.Generator | None = None) -> np.ndarray:
    if condition == "original":
        return x
    if condition == "mp3_64k":
        return _ffmpeg_roundtrip(x, sr, ["-c:a", "libmp3lame", "-b:a", "64k"], "mp3")
    if condition == "aac_48k":
        return _ffmpeg_roundtrip(x, sr, ["-c:a", "aac", "-b:a", "48k"], "adts", "aac")
    if condition == "opus_16k":  # messaging-app voice note
        return _ffmpeg_roundtrip(x, sr, ["-c:a", "libopus", "-b:a", "16k", "-application", "voip"], "ogg")
    if condition == "narrowband_8k":  # telephone channel
        from app.analysis.dsp import resample

        return resample(resample(x, sr, 8000), 8000, sr)
    if condition.startswith("noise_snr"):
        snr = float(condition.removeprefix("noise_snr"))
        rng = rng or np.random.default_rng(0)
        p = float(np.mean(x.astype(np.float64) ** 2)) + 1e-12
        n = rng.standard_normal(len(x))
        # Pink-ish noise (1/f) is closer to real background than white noise.
        spec = np.fft.rfft(n)
        f = np.arange(spec.size) + 1
        n = np.fft.irfft(spec / np.sqrt(f), n=len(x))
        n *= np.sqrt(p / (10 ** (snr / 10)) / (np.mean(n**2) + 1e-12))
        return (x + n).astype(np.float32)
    raise ValueError(condition)
