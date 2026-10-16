"""AASIST (Jung et al., ICASSP 2022) with the official ASVspoof 2019 LA weights.

Included as a permissively licensed (MIT) reference detector. It was trained
only on ASVspoof 2019 LA (2019-era TTS/VC systems) and is known to generalise
poorly to modern, in-the-wild deepfakes (independently measured EER ≈ 43% on
In-the-Wild). Its calibration file therefore decides whether it may influence
verdicts; by default it is shown as a reference score only.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

from ...config import get_settings
from . import ModelInfo, SyntheticDetector

NB_SAMP = 64600
MODEL_CONFIG = {
    "architecture": "AASIST",
    "nb_samp": NB_SAMP,
    "first_conv": 128,
    "filts": [70, [1, 32], [32, 32], [32, 64], [64, 64]],
    "gat_dims": [64, 32],
    "pool_ratios": [0.5, 0.7, 0.5, 0.5],
    "temperatures": [2.0, 2.0, 100.0, 100.0],
}


def _pad(x: np.ndarray, n: int = NB_SAMP) -> np.ndarray:
    """Repeat-pad / crop to n samples, as in the official evaluation code."""
    if len(x) >= n:
        return x[:n]
    reps = int(np.ceil(n / max(1, len(x))))
    return np.tile(x, reps)[:n]


class AasistDetector(SyntheticDetector):
    info = ModelInfo(
        id="aasist",
        name="AASIST (ASVspoof 2019 LA)",
        version="clovaai/aasist AASIST.pth",
        architecture="Sinc-convolution front end, residual encoder, heterogeneous spectro-temporal graph attention (297k parameters)",
        training_data="ASVspoof 2019 Logical Access training partition (English, VCTK speakers, 2019-era TTS/VC).",
        license="MIT (code and weights)",
        license_url="https://github.com/clovaai/aasist/blob/main/LICENSE",
        commercial_use=True,
        source_url="https://github.com/clovaai/aasist",
        paper="J. Jung et al., AASIST: Audio Anti-Spoofing using Integrated Spectro-Temporal Graph Attention Networks, ICASSP 2022",
        published_results=[
            {"dataset": "ASVspoof 2019 LA eval", "eer_percent": 0.83, "source": "paper"},
            {"dataset": "In-the-Wild", "eer_percent": 43.01, "source": "SpeechAntiSpoofingBenchmarks (2026)"},
        ],
        notes=[
            "Generalises poorly beyond ASVspoof 2019; treat as a reference score.",
            "Scores the first 4.04 s of each window (repeat-padded if shorter).",
        ],
    )

    def _weights_path(self) -> Path | None:
        p = get_settings().model_dir / "aasist" / "AASIST.pth"
        return p if p.exists() else None

    def availability(self) -> tuple[str, str | None]:
        if importlib.util.find_spec("torch") is None:
            return "unavailable", "Detection model not configured: PyTorch is not installed on the analysis worker."
        if self._weights_path() is None:
            return "not_configured", (
                "Detection model not configured: AASIST.pth is not present. Run "
                "`python -m app.cli download-models` on the analysis worker."
            )
        if self._load_error:
            return "unavailable", f"Model failed to load: {self._load_error}"
        return "ready", None

    def _load(self):
        import torch

        from .aasist_model import Model

        model = Model(MODEL_CONFIG)
        state = torch.load(str(self._weights_path()), map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        model.eval()
        return model

    def _scores(self, model, windows: list[np.ndarray]) -> np.ndarray:
        import torch

        batch = np.stack([_pad(np.asarray(w, dtype=np.float32)) for w in windows])
        with torch.inference_mode():
            _, out = model(torch.from_numpy(batch))
        out = out.numpy().astype(np.float64)
        return out[:, 0] - out[:, 1]  # index 1 = bona fide in the official code
