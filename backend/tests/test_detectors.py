"""Detector behaviour on controlled signals with known manipulations."""

import numpy as np
import pytest
from conftest import SR, pink_noise, speech_like

from app.analysis import comparison, fusion, pipeline
from app.analysis.context import build_context
from app.analysis.detectors import bandwidth, digital_silence, duplication, enf, noise_floor
from app.analysis.dsp import resample

MEDIA = {"codec": "pcm_s16le", "container": "wav", "sample_rate": SR, "channels": 1}


def ctx_of(x, sr=SR):
    return build_context(x, sr, media=MEDIA)


def near(cands, t, tol=0.6):
    return [c for c in cands if c.start - tol <= t <= c.end + tol]


def test_digital_silence_detected_in_noisy_recording():
    x = speech_like(14, seed=1, noise_db=-50)
    i = 7 * SR
    y = np.concatenate([x[:i], np.zeros(int(0.4 * SR), np.float32), x[i:]])
    out = digital_silence.run(ctx_of(y))
    assert out.status == "ok"
    hits = near(out.candidates, 7.0)
    assert hits and hits[0].strength >= 0.6
    assert abs(hits[0].measurements["duration_ms"] - 400) < 20


def test_digital_silence_noise_gate_pattern_downweighted():
    x = speech_like(16, seed=2, noise_db=-50)
    ctx = ctx_of(x)
    y = x.copy()
    # Gate every pause: zero everything outside speech.
    speech = np.repeat(ctx.vad.speech, 160)[: len(y)]
    y[: len(speech)][~speech] = 0.0
    out = digital_silence.run(ctx_of(y))
    assert out.summary.get("processing_pattern") or out.status == "not_applicable"
    assert all(c.strength <= 0.15 for c in out.candidates)


def test_duplication_found_with_source():
    x = speech_like(16, seed=3)
    seg = x[4 * SR : int(5.2 * SR)].copy()
    y = np.concatenate([x[: 11 * SR], seg, x[11 * SR :]])
    out = duplication.run(ctx_of(y))
    assert out.candidates, out.summary
    c = max(out.candidates, key=lambda c: c.strength)
    assert abs(c.start - 11.0) < 0.15 and abs(c.measurements["source_start"] - 4.0) < 0.15
    assert c.measurements["sample_identical"] is True
    assert c.strength >= 0.95


def test_no_duplication_in_unedited_signal():
    out = duplication.run(ctx_of(speech_like(16, seed=4)))
    assert out.candidates == []


def test_bandwidth_change_from_telephone_insert():
    x = speech_like(16, seed=5, noise_db=-70)
    seg = resample(resample(x[6 * SR : 10 * SR], SR, 8000), 8000, SR)[: 4 * SR]
    y = x.copy()
    y[6 * SR : 10 * SR] = seg
    out = bandwidth.run(ctx_of(y))
    assert near(out.candidates, 6.0, 0.4) and near(out.candidates, 10.0, 0.4), [
        (c.start, c.measurements) for c in out.candidates
    ]
    assert bandwidth.run(ctx_of(x)).candidates == []


def test_background_change_detected():
    x = speech_like(18, seed=6, noise_db=-60)
    y = x.copy()
    y[9 * SR :] += pink_noise(len(y) - 9 * SR, -38, np.random.default_rng(9))
    out = noise_floor.run(ctx_of(y))
    assert out.status == "ok"
    hits = near(out.candidates, 9.0, 1.0)
    assert hits and hits[0].strength > 0.5, [(c.start, c.end, c.strength) for c in out.candidates]


def _with_hum(x, phase_jump_at=None):
    t = np.arange(len(x)) / SR
    hum = 0.01 * np.sin(2 * np.pi * 50.0 * t)
    if phase_jump_at is not None:
        k = int(phase_jump_at * SR)
        hum[k:] = 0.01 * np.sin(2 * np.pi * 50.0 * t[k:] + 2.2)
    return (x + hum).astype(np.float32)


def test_enf_phase_jump_detected():
    x = speech_like(24, seed=7)
    out = enf.run(ctx_of(_with_hum(x, phase_jump_at=12.0)))
    assert out.status == "ok"
    assert near(out.candidates, 12.0, 0.5)
    clean = enf.run(ctx_of(_with_hum(x)))
    assert not near(clean.candidates, 12.0, 0.5)
    assert all(c.strength < 0.5 for c in clean.candidates)


def test_enf_not_applicable_without_hum():
    out = enf.run(ctx_of(speech_like(24, seed=8)))
    assert out.status == "not_applicable"


def test_pipeline_runs_without_ml_and_reports_not_configured():
    x = speech_like(20, seed=10)
    r = pipeline.run(x, SR, media=MEDIA, size_bytes=1, uploaded_at=None, run_synthetic=True)
    assert r["assessments"]["synthetic"]["status"] == "not_configured"
    assert r["assessments"]["synthetic"]["label"] == "Detection model not configured"
    # Without synthetic detection a clean result must not be presented as "no indicators".
    assert r["overall"]["status"] == "inconclusive"
    assert all(d["status"] in ("ok", "not_applicable") for d in r["detectors"] if d["kind"] == "signal")
    assert r["pipeline_version"]


def test_pipeline_flags_duplicate_and_silence():
    x = speech_like(24, seed=11, noise_db=-50)
    seg = x[3 * SR : int(4.5 * SR)].copy()
    y = np.concatenate([x[: 12 * SR], seg, x[12 * SR : 18 * SR], np.zeros(int(0.5 * SR), np.float32), x[18 * SR :]])
    r = pipeline.run(y, SR, media=MEDIA, size_bytes=1, uploaded_at=None, run_synthetic=False)
    labels = {(f["label"], round(f["start"])) for f in r["findings"]}
    assert ("Possible duplicated segment", 12) in labels
    assert any(f["category"] == "edit" and f["start"] - 0.3 <= 19.5 <= f["end"] + 0.3 for f in r["findings"]), r[
        "findings"
    ]
    assert r["assessments"]["editing"]["status"] in ("possible", "strong")
    for f in r["findings"]:
        assert f["confirmed"] is False and f["evidence"] and f["summary"]


def test_segment_offsets_are_absolute():
    x = speech_like(20, seed=12, noise_db=-50)
    y = np.concatenate([x[: 10 * SR], np.zeros(int(0.4 * SR), np.float32), x[10 * SR :]])
    seg = y[5 * SR : 16 * SR]
    r = pipeline.run(
        seg,
        SR,
        media=MEDIA,
        size_bytes=1,
        uploaded_at=None,
        offset=5.0,
        scope_end=16.0,
        whole_file=False,
        run_synthetic=False,
    )
    assert any(f["start"] - 0.3 <= 10.0 <= f["end"] + 0.3 for f in r["findings"]), r["findings"]
    assert r["scope"] == {"whole_file": False, "start": 5.0, "end": 16.0}


def test_fusion_requires_agreement_for_high_severity():
    from app.analysis.base import Candidate, DetectorOutput

    def out(det, fam, s, t):
        o = DetectorOutput(id=det, name=det, family=fam, version="t", method="")
        o.candidates = [Candidate(det, fam, t, t + 0.05, s, {}, "x")]
        return o

    single = fusion.fuse_edits([out("discontinuity", "waveform", 0.45, 5.0)])
    assert single["findings"] == []
    both = fusion.fuse_edits([out("noise_floor", "background", 0.8, 5.0), out("bandwidth", "spectral", 0.85, 5.1)])
    assert len(both["findings"]) == 1 and both["findings"][0]["severity"] == "high"
    assert both["findings"][0]["label"] == "Possible edit"


def test_synthetic_assessment_uses_only_calibrated_detectors():
    from app.analysis.base import DetectorOutput

    def ml(use, flags):
        o = DetectorOutput(id="m", name="m", family="synthetic", version="1", method="", kind="ml")
        o.summary = {
            "use_for_verdict": use,
            "windows_scored": len(flags),
            "fraction_possible": float(np.mean([f != "none" for f in flags])),
            "windows": [{"scored": True, "flag": f} for f in flags],
        }
        return o

    q = {"blocks": {"synthetic": False, "edit": False}}
    assert fusion.assess_synthetic([ml(False, ["strong"] * 4)], q)["status"] == "inconclusive"
    assert fusion.assess_synthetic([ml(True, ["none", "strong", "strong", "none"])], q)["status"] == "strong"
    assert fusion.assess_synthetic([ml(True, ["none", "possible", "none"])], q)["status"] == "possible"
    assert fusion.assess_synthetic([ml(True, ["none"] * 5)], q)["status"] == "none"
    q_bad = {"blocks": {"synthetic": True, "edit": False}}
    assert fusion.assess_synthetic([ml(True, ["none"] * 5)], q_bad)["status"] == "inconclusive"


@pytest.mark.parametrize("gain", [1.0, 0.6])
def test_comparison_finds_cut_insert_and_reorder(gain):
    a = speech_like(30, seed=13)
    other = speech_like(4, seed=99, f0=210)
    b = (
        np.concatenate(
            [a[: 5 * SR], a[8 * SR : 18 * SR], other, a[18 * SR : 24 * SR], a[27 * SR :], a[24 * SR : 27 * SR]]
        )
        * gain
    )
    r = comparison.compare(a, b.astype(np.float32))
    s = r["summary"]
    assert s["shares_content"]
    kinds = [p["kind"] for p in r["splice_points"]]
    assert "removed" in kinds and "inserted" in kinds and "reordered" in kinds, r["splice_points"]
    assert any(abs(x["a_start"] - 5.0) < 0.3 and abs(x["a_end"] - 8.0) < 0.3 for x in r["removed"]), r["removed"]
    assert abs(s["median_level_difference_db"] - 20 * np.log10(gain)) < 0.5


def test_comparison_unrelated_recordings():
    r = comparison.compare(speech_like(10, seed=20), speech_like(10, seed=21, f0=220))
    assert r["summary"]["shares_content"] is False
