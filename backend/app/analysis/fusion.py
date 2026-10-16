"""Combine detector evidence into findings, assessments and an overall verdict.

Edit evidence: candidates from the signal detectors are clustered in time. The
evidence of each *family* (background, spectral, waveform, ...) is the strongest
candidate of that family in the cluster; families are combined with a weighted
noisy-OR, so agreement between independent kinds of evidence raises the score,
while many weak observations of one kind do not. Thresholds come from the edit
calibration file.

Synthetic evidence: only detectors whose calibration file allows it
(``use_for_verdict``) can move the synthetic-speech assessment; their windows
are flagged against calibrated thresholds.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .base import FAMILY_LABELS, Candidate, DetectorOutput
from .calibration import edit_calibration

VERDICTS = {
    "none": "No significant manipulation indicators detected",
    "possible": "Possible manipulation detected",
    "strong": "Strong indicators of synthetic or manipulated audio",
    "inconclusive": "Inconclusive — more evidence required",
}
RANK = {"none": 0, "inconclusive": 1, "possible": 2, "strong": 3}


def _cluster(cands: list[Candidate], tol: float) -> list[list[Candidate]]:
    cands = sorted(cands, key=lambda c: c.start)
    clusters: list[list[Candidate]] = []
    end = -np.inf
    for c in cands:
        if clusters and c.start - tol <= end and (c.end - clusters[-1][0].start) < 3.0:
            clusters[-1].append(c)
            end = max(end, c.end + tol)
        else:
            clusters.append([c])
            end = c.end + tol
    return clusters


def _label(families: dict[str, float], members: list[Candidate], report_thr: float) -> str:
    strong_fams = [f for f, s in families.items() if s >= 0.3]
    if any(c.detector == "digital_silence" and c.strength >= 0.5 for c in members):
        return "Possible edit"
    if "enf" in families and families["enf"] >= 0.5:
        return "Possible edit"
    if len(strong_fams) >= 2:
        return "Possible edit"
    if "spectral" in families and any(c.detector == "bandwidth" for c in members):
        return "Possible edit" if families["spectral"] >= report_thr else "Acoustic discontinuity"
    return "Acoustic discontinuity"


def fuse_edits(outputs: list[DetectorOutput]) -> dict[str, Any]:
    cal = edit_calibration()
    fz = cal["fusion"]
    weights = fz["family_weights"]
    obs_thr, rep_thr, high_thr = fz["observation_threshold"], fz["report_threshold"], fz["high_threshold"]

    boundary: list[Candidate] = []
    pairs: list[Candidate] = []
    for o in outputs:
        if o.kind != "signal" or o.status != "ok":
            continue
        for c in o.candidates:
            (pairs if c.kind == "pair" else boundary).append(c)

    findings: list[dict] = []
    observations: list[dict] = []

    for members in _cluster(boundary, fz["cluster_tolerance_s"]):
        fam: dict[str, float] = {}
        for c in members:
            fam[c.family] = max(fam.get(c.family, 0.0), c.strength)
        score = 1.0 - float(np.prod([1.0 - weights.get(f, 0.5) * s for f, s in fam.items()]))
        # Localise from the stronger evidence only (weak, wide members would blur the interval).
        top = max(c.strength for c in members)
        core = [c for c in members if c.strength >= 0.5 * top]
        start = min(c.start for c in core)
        end = max(c.end for c in core)
        label = _label(fam, members, rep_thr)
        entry = {
            "start": round(start, 3),
            "end": round(end, 3),
            "score": round(score, 4),
            "label": label,
            "families": {f: round(s, 4) for f, s in sorted(fam.items(), key=lambda kv: -kv[1])},
            "evidence": [c.to_dict() for c in sorted(members, key=lambda c: -c.strength)],
        }
        if score >= rep_thr:
            n_fam = sum(1 for s in fam.values() if s >= 0.3)
            entry["severity"] = "high" if score >= high_thr and (n_fam >= 2 or label == "Possible edit") else "medium"
            entry["category"] = "edit"
            findings.append(entry)
        elif score >= obs_thr:
            entry["severity"] = "low"
            observations.append(entry)

    for c in pairs:
        if c.strength < rep_thr:
            continue
        near = [
            b for b in boundary if (abs(b.center - c.start) < 0.3 or abs(b.center - c.end) < 0.3) and b.strength >= 0.2
        ]
        findings.append(
            {
                "start": round(c.start, 3),
                "end": round(c.end, 3),
                "score": round(c.strength, 4),
                "label": "Possible duplicated segment",
                "severity": "high" if c.strength >= high_thr else "medium",
                "category": "duplication",
                "families": {"duplication": round(c.strength, 4)},
                "related": c.related,
                "evidence": [c.to_dict()] + [b.to_dict() for b in near],
            }
        )

    findings.sort(key=lambda f: f["start"])
    observations.sort(key=lambda f: f["start"])
    return {
        "findings": findings,
        "observations": observations,
        "thresholds": {"observation": obs_thr, "report": rep_thr, "high": high_thr},
        "calibration": cal["provenance"],
        "calibration_version": cal["version"],
    }


def assess_edits(edit: dict, outputs: list[DetectorOutput], quality: dict) -> dict:
    ran = [o for o in outputs if o.kind == "signal" and o.status == "ok"]
    failed = [o for o in outputs if o.kind == "signal" and o.status == "failed"]
    findings = edit["findings"]
    reasons: list[str] = []
    if any(f["severity"] == "high" for f in findings):
        status = "strong"
        reasons.append(f"{sum(f['severity'] == 'high' for f in findings)} high-severity editing finding(s).")
    elif findings:
        status = "possible"
        reasons.append(f"{len(findings)} editing finding(s) above the reporting threshold.")
    elif quality["blocks"]["edit"]:
        status = "inconclusive"
        reasons.append("Recording quality is too limited for reliable edit detection.")
    elif len(ran) < 3:
        status = "inconclusive"
        reasons.append("Too few editing checks were applicable to this recording.")
    else:
        status = "none"
        reasons.append(f"{len(ran)} editing checks ran; none produced evidence above the reporting threshold.")
    if failed:
        reasons.append(f"{len(failed)} check(s) failed to run: " + ", ".join(o.name for o in failed) + ".")
    return {
        "status": status,
        "label": VERDICTS[status],
        "reasons": reasons,
        "checks_run": [o.id for o in ran],
        "checks_not_applicable": [
            {"id": o.id, "name": o.name, "detail": o.status_detail}
            for o in outputs
            if o.kind == "signal" and o.status == "not_applicable"
        ],
    }


def assess_synthetic(outputs: list[DetectorOutput], quality: dict) -> dict:
    ml = [o for o in outputs if o.kind == "ml"]
    ready = [o for o in ml if o.status == "ok"]
    voting = [o for o in ready if o.summary.get("use_for_verdict")]
    reasons: list[str] = []
    findings: list[dict] = []
    if not ml or all(o.status == "skipped" for o in ml):
        detail = "; ".join(o.status_detail or "" for o in ml) or "No synthetic-speech detector is enabled."
        return {
            "status": "not_configured",
            "label": "Detection model not configured",
            "reasons": [detail],
            "findings": [],
            "detectors": [o.id for o in ml],
        }
    if not ready:
        return {
            "status": "inconclusive",
            "label": VERDICTS["inconclusive"],
            "reasons": [o.status_detail or "Detector could not be applied." for o in ml],
            "findings": [],
            "detectors": [o.id for o in ml],
        }
    if not voting:
        return {
            "status": "inconclusive",
            "label": VERDICTS["inconclusive"],
            "reasons": [
                "No calibrated synthetic-speech detector is approved for verdicts on this server; "
                "raw model scores are shown for reference only."
            ],
            "findings": [],
            "detectors": [o.id for o in ml],
        }
    per: dict[str, str] = {}
    for o in voting:
        s = o.summary
        strong_run = _max_run([w for w in s["windows"] if w.get("flag") is not None], "strong")
        n_scored = s["windows_scored"]
        if strong_run >= 2 or (n_scored <= 2 and strong_run >= 1):
            per[o.id] = "strong"
        elif (s.get("fraction_possible") or 0) > 0:
            per[o.id] = "possible"
        else:
            per[o.id] = "none"
        for c in o.candidates:
            findings.append(
                {
                    "start": round(c.start, 3),
                    "end": round(c.end, 3),
                    "score": round(c.strength, 4),
                    "label": "Possible synthetic speech",
                    "severity": "high" if c.measurements.get("strong_windows", 0) >= 2 else "medium",
                    "category": "synthetic",
                    "families": {"synthetic": round(c.strength, 4)},
                    "evidence": [c.to_dict()],
                    "detector": o.id,
                }
            )
    statuses = set(per.values())
    if len(voting) > 1 and "strong" in statuses and "none" in statuses:
        status = "inconclusive"
        reasons.append(
            "Calibrated detectors disagree strongly (" + ", ".join(f"{k}: {v}" for k, v in per.items()) + ")."
        )
    else:
        status = max(statuses, key=lambda v: RANK[v])
        for k, v in per.items():
            reasons.append(f"{k}: {VERDICTS[v].lower()}.")
    if status == "none" and quality["blocks"]["synthetic"]:
        status = "inconclusive"
        reasons.append("Recording quality limits the reliability of synthetic-speech detection.")
    return {
        "status": status,
        "label": VERDICTS[status],
        "reasons": reasons,
        "findings": findings,
        "detectors": [o.id for o in ml],
        "voting_detectors": [o.id for o in voting],
    }


def _max_run(windows: list[dict], flag: str) -> int:
    best = cur = 0
    for w in windows:
        if not w.get("scored", True) or w.get("flag") is None:
            continue
        if w["flag"] == flag:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


def overall(edit_a: dict, synth_a: dict, quality: dict) -> dict:
    statuses = [edit_a["status"], synth_a["status"]]
    caveats: list[str] = []
    if synth_a["status"] == "not_configured":
        caveats.append("Synthetic-speech detection was not available, so AI-generated speech was not assessed.")
    effective = [s for s in statuses if s != "not_configured"]
    top = max(effective, key=lambda s: RANK[s]) if effective else "inconclusive"
    if top == "none" and synth_a["status"] in ("not_configured", "inconclusive"):
        top = "inconclusive"
    if top == "none":
        caveats.append(
            "This result does not prove the recording is authentic. It means the checks that were "
            "applicable found no evidence above their validated thresholds."
        )
    return {
        "status": top,
        "label": VERDICTS[top],
        "caveats": caveats,
        "components": {"editing": edit_a["status"], "synthetic": synth_a["status"]},
        "quality": quality["overall"],
    }


def recommendations(edit_a: dict, synth_a: dict, quality: dict, metadata: dict) -> list[str]:
    recs: list[str] = []
    if edit_a["status"] in ("possible", "strong") or synth_a["status"] in ("possible", "strong"):
        recs.append("Listen to every flagged interval on good headphones and compare it with the surrounding audio.")
        recs.append(
            "Request the original file directly from the recording device (not a forwarded or exported copy) "
            "and, if available, use the comparison tool to check it against this version."
        )
        recs.append("Have the findings reviewed by a qualified forensic audio examiner before relying on them.")
    if any(f["id"] in ("messaging_app_format", "metadata_converter") for f in metadata["findings"]):
        recs.append(
            "This file was likely re-encoded by an app or converter. The original device recording would "
            "preserve more evidence (metadata, bandwidth, fine waveform detail)."
        )
    if quality["blocks"]["synthetic"] or quality["blocks"]["edit"]:
        recs.append("Obtain a longer or cleaner recording; quality issues limited this analysis.")
    if synth_a["status"] in ("not_configured", "inconclusive"):
        recs.append(
            "Synthetic-speech assessment is incomplete; consider additional, independently validated "
            "detectors or human expert review."
        )
    if synth_a["status"] in ("possible", "strong"):
        recs.append(
            "Corroborate with context: who supplied the recording, when and how it was obtained, and whether "
            "the speaker can confirm or deny it. Voice-clone detection does not identify the speaker."
        )
    if not recs:
        recs.append(
            "No indicators were found by the applicable checks. If the recording's authenticity is "
            "material, still verify its provenance and chain of custody independently."
        )
    return recs


def family_label(f: str) -> str:
    return FAMILY_LABELS.get(f, f)
