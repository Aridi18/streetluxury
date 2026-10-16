"""Synthetic-speech model integration tests (skipped when weights are not installed)."""

import glob
import os

import numpy as np
import pytest

from app.analysis.synthetic import registry
from app.analysis.synthetic.antideepfake import _map_key

pytestmark = pytest.mark.ml


def _ready(det_id):
    det = registry()[det_id]
    state, detail = det.availability()
    if state != "ready":
        pytest.skip(f"{det_id}: {detail}")
    return det


def test_fairseq_key_mapping():
    assert (
        _map_key("m_ssl.model.encoder.layers.3.self_attn.q_proj.weight") == "encoder.layers.3.attention.q_proj.weight"
    )
    assert _map_key("m_ssl.model.encoder.layers.0.fc2.bias") == "encoder.layers.0.feed_forward.output_dense.bias"
    assert _map_key("m_ssl.model.post_extract_proj.weight") == "feature_projection.projection.weight"
    assert _map_key("m_ssl.model.layer_norm.bias") == "feature_projection.layer_norm.bias"
    assert (
        _map_key("m_ssl.model.encoder.pos_conv.0.weight_g")
        == "encoder.pos_conv_embed.conv.parametrizations.weight.original0"
    )
    assert (
        _map_key("m_ssl.model.feature_extractor.conv_layers.0.2.weight")
        == "feature_extractor.conv_layers.0.layer_norm.weight"
    )
    assert _map_key("m_ssl.model.quantizer.vars") is None
    assert _map_key("proj_fc.weight") is None


def test_antideepfake_loads_all_weights_and_scores():
    det = _ready("antideepfake-w2v2-small")
    det.model()  # raises if any encoder parameter is missing or unexpected
    rng = np.random.default_rng(0)
    scores = det.raw_scores(
        [rng.standard_normal(16000 * 2).astype(np.float32) * 0.05, np.zeros(16000, np.float32) + 1e-4]
    )
    assert scores.shape == (2,) and np.isfinite(scores).all()


@pytest.mark.skipif(not os.environ.get("AS_LIBRISPEECH_DIR"), reason="set AS_LIBRISPEECH_DIR to run")
def test_antideepfake_scores_real_speech_as_genuine():
    import soundfile as sf

    det = _ready("antideepfake-w2v2-small")
    files = sorted(glob.glob(os.path.join(os.environ["AS_LIBRISPEECH_DIR"], "*", "*", "*.flac")))[:8]
    wins = [sf.read(f, dtype="float32")[0][: 4 * 16000] for f in files]
    scores = det.raw_scores(wins)
    assert np.median(scores) < -3  # log-odds strongly favour genuine speech


def test_aasist_loads_and_scores():
    det = _ready("aasist")
    s = det.raw_scores([np.random.default_rng(1).standard_normal(64600).astype(np.float32) * 0.05])
    assert np.isfinite(s).all()


def test_unconfigured_detector_reports_not_configured(monkeypatch, tmp_path):
    from app.analysis.synthetic.aasist import AasistDetector
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "model_dir", tmp_path)
    state, detail = AasistDetector().availability()
    assert state in ("not_configured", "unavailable")
    assert "Detection model not configured" in detail
