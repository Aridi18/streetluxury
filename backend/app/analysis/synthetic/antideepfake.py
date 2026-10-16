"""NII AntiDeepfake (Wav2Vec2-Small post-trained for deepfake detection).

Ge, Wang, Liu, Yamagishi et al., "Post-training for Deepfake Speech Detection"
(arXiv:2506.21090). The checkpoint is published in fairseq parameter naming;
we load it into the equivalent Hugging Face ``Wav2Vec2Model`` (post-LayerNorm,
group-norm feature extractor) by renaming parameters, then apply the original
mean-pooling + linear head. Inputs are 16 kHz mono waveforms normalised with
layer norm over the whole input, exactly as in the reference inference script.

Licence: model weights CC BY-NC-SA 4.0 (non-commercial). Code BSD-3-Clause.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import numpy as np

from ...config import get_settings
from . import ModelInfo, SyntheticDetector

WEIGHTS_FILE = "model.safetensors"


def _map_key(k: str) -> str | None:
    if not k.startswith("m_ssl.model."):
        return None
    k = k[len("m_ssl.model.") :]
    if k.startswith(("quantizer.", "project_q.", "final_proj.")) or k == "mask_emb":
        return None  # pre-training heads, unused for features
    m = re.match(r"feature_extractor\.conv_layers\.(\d+)\.0\.weight", k)
    if m:
        return f"feature_extractor.conv_layers.{m.group(1)}.conv.weight"
    m = re.match(r"feature_extractor\.conv_layers\.0\.2\.(weight|bias)", k)
    if m:
        return f"feature_extractor.conv_layers.0.layer_norm.{m.group(1)}"
    if k.startswith("layer_norm."):
        return "feature_projection." + k
    if k.startswith("post_extract_proj."):
        return "feature_projection.projection." + k.split(".", 1)[1]
    if k == "encoder.pos_conv.0.bias":
        return "encoder.pos_conv_embed.conv.bias"
    if k == "encoder.pos_conv.0.weight_g":
        return "encoder.pos_conv_embed.conv.parametrizations.weight.original0"
    if k == "encoder.pos_conv.0.weight_v":
        return "encoder.pos_conv_embed.conv.parametrizations.weight.original1"
    if k.startswith("encoder.layer_norm."):
        return k
    m = re.match(r"encoder\.layers\.(\d+)\.(.+)", k)
    if m:
        i, rest = m.groups()
        rest = (
            rest.replace("self_attn_layer_norm.", "layer_norm.")
            .replace("self_attn.", "attention.")
            .replace("fc1.", "feed_forward.intermediate_dense.")
            .replace("fc2.", "feed_forward.output_dense.")
        )
        return f"encoder.layers.{i}.{rest}"
    return None


class AntiDeepfakeDetector(SyntheticDetector):
    info = ModelInfo(
        id="antideepfake-w2v2-small",
        name="AntiDeepfake Wav2Vec2-Small (NII)",
        version="hf:nii-yamagishilab/wav2vec-small-anti-deepfake@9a13264",
        architecture="Wav2Vec 2.0 Base (95M) self-supervised front end, mean pooling, linear classifier",
        training_data=(
            "Post-trained on ~56k h genuine and ~18k h synthetic speech from 29 corpora (ASVspoof "
            "2019/2021/5, MLAAD, CVoiceFake, SpoofCeleb, CodecFake, WaveFake, LibriTTS-R, FLEURS-R, "
            "VoxCeleb2-vocoded, ...), over 100 languages. In-the-Wild, FakeOrReal, ADD2023, "
            "DeepVoice and Deepfake-Eval-2024 were held out for testing."
        ),
        license="CC BY-NC-SA 4.0 (weights); BSD-3-Clause (code)",
        license_url="https://creativecommons.org/licenses/by-nc-sa/4.0/",
        commercial_use=False,
        source_url="https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake",
        paper="W. Ge et al., Post-training for Deepfake Speech Detection, arXiv:2506.21090 (2025)",
        published_results=[
            {"dataset": "In-the-Wild", "eer_percent": 4.24, "roc_auc": 0.993, "source": "model card"},
            {"dataset": "Deepfake-Eval-2024", "eer_percent": 33.33, "roc_auc": 0.736, "source": "model card"},
            {"dataset": "FakeOrReal", "eer_percent": 22.03, "roc_auc": 0.868, "source": "model card"},
            {"dataset": "ADD2023", "eer_percent": 13.02, "roc_auc": 0.946, "source": "model card"},
        ],
        notes=[
            "Utterance-level classifier; window-level scores approximate localisation of partially "
            "synthetic audio but the model was not trained for segment localisation.",
            "Non-commercial licence: replace or license separately before commercial deployment.",
            "Does not identify which generator or voice-cloning service produced the audio.",
        ],
    )

    def _weights_path(self) -> Path | None:
        s = get_settings()
        local = s.model_dir / "antideepfake-w2v2-small" / WEIGHTS_FILE
        if local.exists():
            return local
        try:
            from huggingface_hub import try_to_load_from_cache

            p = try_to_load_from_cache(
                s.antideepfake_repo, WEIGHTS_FILE, cache_dir=str(s.model_dir), revision=s.antideepfake_revision
            )
            if isinstance(p, str) and Path(p).exists():
                return Path(p)
        except ImportError:
            return None
        return None

    def availability(self) -> tuple[str, str | None]:
        missing = [m for m in ("torch", "transformers", "safetensors") if importlib.util.find_spec(m) is None]
        if missing:
            return "unavailable", (
                f"Detection model not configured: Python packages {', '.join(missing)} are not installed "
                "on the analysis worker (install backend[ml])."
            )
        if self._weights_path() is None and not get_settings().allow_model_download:
            return "not_configured", (
                "Detection model not configured: weights are not present. Run "
                "`python -m app.cli download-models` on the analysis worker."
            )
        if self._load_error:
            return "unavailable", f"Model failed to load: {self._load_error}"
        return "ready", None

    def _load(self):
        import torch
        from safetensors.torch import load_file
        from transformers import Wav2Vec2Config, Wav2Vec2Model

        s = get_settings()
        path = self._weights_path()
        if path is None:
            from huggingface_hub import hf_hub_download

            path = Path(
                hf_hub_download(
                    s.antideepfake_repo, WEIGHTS_FILE, revision=s.antideepfake_revision, cache_dir=str(s.model_dir)
                )
            )
        state = load_file(str(path))
        cfg = Wav2Vec2Config(
            hidden_size=768,
            num_hidden_layers=12,
            num_attention_heads=12,
            intermediate_size=3072,
            feat_extract_norm="group",
            do_stable_layer_norm=False,
            conv_bias=False,
            hidden_act="gelu",
            apply_spec_augment=False,
            layerdrop=0.0,
        )
        ssl = Wav2Vec2Model(cfg)
        mapped = {}
        for k, v in state.items():
            nk = _map_key(k)
            if nk is not None:
                mapped[nk] = v
        missing, unexpected = ssl.load_state_dict(mapped, strict=False)
        missing = [m for m in missing if m != "masked_spec_embed"]
        if missing or unexpected:
            self._load_error = f"weight mapping mismatch (missing={missing[:3]}, unexpected={unexpected[:3]})"
            raise RuntimeError(self._load_error)
        head = torch.nn.Linear(768, 2)
        head.load_state_dict({"weight": state["proj_fc.weight"], "bias": state["proj_fc.bias"]})
        ssl.eval()
        head.eval()
        return ssl, head

    def _scores(self, model, windows: list[np.ndarray]) -> np.ndarray:
        import torch

        ssl, head = model
        out = []
        with torch.inference_mode():
            # Variable-length inputs are scored one at a time (no padding artefacts).
            for w in windows:
                wav = torch.from_numpy(np.ascontiguousarray(w, dtype=np.float32))
                wav = torch.nn.functional.layer_norm(wav, wav.shape).unsqueeze(0)
                hidden = ssl(wav).last_hidden_state  # [1, T, 768]
                logits = head(hidden.mean(dim=1))[0]  # [fake, real]
                out.append(float(logits[0] - logits[1]))
        return np.asarray(out, dtype=np.float64)
