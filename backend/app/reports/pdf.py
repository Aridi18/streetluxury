"""Forensic PDF report (generated on demand; never stored on the server)."""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, Line, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..analysis import visuals

PURPLE = colors.HexColor("#6D3FD1")
PURPLE_LIGHT = colors.HexColor("#EFE9FC")
INK = colors.HexColor("#14131A")
MUTED = colors.HexColor("#5B5869")
RULE = colors.HexColor("#D9D6E2")
VERDICT_COLOURS = {
    "none": colors.HexColor("#2E7D5B"),
    "possible": colors.HexColor("#B7791F"),
    "strong": colors.HexColor("#B4233C"),
    "inconclusive": colors.HexColor("#5B5869"),
    "not_configured": colors.HexColor("#5B5869"),
}
SEV_COLOURS = {"high": "#B4233C", "medium": "#B7791F", "low": "#5B5869"}


def _styles():
    ss = getSampleStyleSheet()
    base = ParagraphStyle(
        "base", parent=ss["Normal"], fontName="Helvetica", fontSize=9, leading=12.5, textColor=INK, alignment=TA_LEFT
    )
    return {
        "base": base,
        "small": ParagraphStyle("small", parent=base, fontSize=7.5, leading=10, textColor=MUTED),
        "h1": ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold", fontSize=17, leading=21),
        "h2": ParagraphStyle(
            "h2",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=15,
            textColor=PURPLE,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base, fontName="Helvetica-Bold", fontSize=9.5, leading=13, spaceBefore=6, spaceAfter=2
        ),
        "verdict": ParagraphStyle(
            "verdict", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.white
        ),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8, leading=10.5),
        "cellb": ParagraphStyle("cellb", parent=base, fontSize=8, leading=10.5, fontName="Helvetica-Bold"),
    }


def _p(text: Any, style) -> Paragraph:
    return Paragraph(escape(str(text if text is not None else "—")), style)


def fmt_time(t: float | None) -> str:
    if t is None:
        return "—"
    m, s = divmod(max(0.0, float(t)), 60)
    return f"{int(m):02d}:{s:06.3f}"


def _kv_table(rows: list[tuple[str, Any]], st, col=(48 * mm, 122 * mm)) -> Table:
    data = [[_p(k, st["cellb"]), _p(v, st["cell"])] for k, v in rows]
    t = Table(data, colWidths=col)
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return t


def _grid(header: list[str], rows: list[list[Any]], widths: list[float], st) -> Table:
    data = [[_p(h, st["cellb"]) for h in header]] + [
        [c if isinstance(c, Paragraph) else _p(c, st["cell"]) for c in r] for r in rows
    ]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PURPLE_LIGHT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return t


def _verdict_box(label: str, status: str, caveats: list[str], st) -> Table:
    inner = [[Paragraph(escape(label), st["verdict"])]]
    for c in caveats:
        inner.append([Paragraph(escape(c), ParagraphStyle("cv", parent=st["base"], textColor=colors.white))])
    t = Table(inner, colWidths=[170 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), VERDICT_COLOURS.get(status, MUTED)),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def _window_chart(windows: list[dict], thresholds: dict | None, key: str) -> Drawing:
    scored = [w for w in windows if w.get(key) is not None]
    d = Drawing(170 * mm, 45 * mm)
    if not scored:
        d.add(String(0, 20, "No scored windows.", fontSize=8))
        return d
    bc = VerticalBarChart()
    bc.x, bc.y = 12 * mm, 6 * mm
    bc.width, bc.height = 155 * mm, 34 * mm
    bc.data = [[float(w[key]) for w in scored]]
    bc.valueAxis.valueMin = 0
    bc.valueAxis.valueMax = 1
    bc.valueAxis.valueStep = 0.25
    bc.valueAxis.labels.fontSize = 6
    bc.categoryAxis.labels.fontSize = 5
    step = max(1, len(scored) // 12)
    bc.categoryAxis.categoryNames = [fmt_time(w["start"])[:5] if i % step == 0 else "" for i, w in enumerate(scored)]
    bc.bars[0].fillColor = PURPLE
    bc.bars[0].strokeColor = None
    bc.barSpacing = 0.5
    d.add(bc)
    if thresholds:
        for name, colour in (("possible", colors.HexColor("#B7791F")), ("strong", colors.HexColor("#B4233C"))):
            v = thresholds.get(name)
            if v is not None and 0 <= v <= 1:
                y = bc.y + bc.height * v
                d.add(Line(bc.x, y, bc.x + bc.width, y, strokeColor=colour, strokeWidth=0.6, strokeDashArray=[2, 2]))
                d.add(String(bc.x + bc.width - 22 * mm, y + 1.5, f"{name} threshold", fontSize=5.5, fillColor=colour))
    return d


def build_analysis_report(
    result: dict, *, analysis_id: str, recording_title: str | None, audit_events: list[dict], peaks: list[float] | None
) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    generated = datetime.now(UTC)

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(INK)
        canvas.rect(0, A4[1] - 14 * mm, A4[0], 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(PURPLE)
        canvas.rect(0, A4[1] - 14 * mm, 4 * mm, 14 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(20 * mm, A4[1] - 9 * mm, "AUDIO SENTINEL")
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0] - 20 * mm, A4[1] - 9 * mm, f"Forensic analysis report · {analysis_id}")
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(
            20 * mm, 10 * mm, f"Generated {generated:%Y-%m-%d %H:%M UTC} · pipeline {result.get('pipeline_version')}"
        )
        canvas.drawRightString(A4[0] - 20 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=18 * mm,
        title="Audio Sentinel forensic report",
        author="Audio Sentinel",
    )
    f = result.get("file", {})
    ov = result["overall"]
    story: list = []
    story.append(Paragraph("Forensic audio analysis", st["h1"]))
    story.append(_p(recording_title or f.get("filename"), st["small"]))
    story.append(Spacer(1, 6))
    story.append(_verdict_box(ov["label"], ov["status"], ov.get("caveats", []), st))
    story.append(Spacer(1, 6))
    ea, sa = result["assessments"]["editing"], result["assessments"]["synthetic"]
    story.append(
        _grid(
            ["Assessment", "Result", "Basis"],
            [
                ["Editing / splicing", ea["label"], " ".join(ea.get("reasons", []))],
                ["Synthetic speech", sa["label"], " ".join(sa.get("reasons", []))],
                [
                    "Recording quality",
                    result["quality"]["overall"].capitalize(),
                    "; ".join(i["title"] for i in result["quality"]["issues"]) or "No significant quality issues.",
                ],
            ],
            [36 * mm, 50 * mm, 84 * mm],
            st,
        )
    )

    story.append(Paragraph("File under examination", st["h2"]))
    scope = result.get("scope", {})
    story.append(
        _kv_table(
            [
                ("File name", f.get("filename")),
                ("Title", f.get("title") or "—"),
                (
                    "Source",
                    {
                        "upload": "Uploaded file",
                        "microphone": "Browser microphone recording",
                        "voice_note": "Messaging-app voice note",
                    }.get(f.get("source"), f.get("source")),
                ),
                ("SHA-256", f.get("sha256")),
                ("Size", f"{f.get('size_bytes', 0):,} bytes"),
                ("Format / codec", f"{f.get('format')} / {f.get('codec')}"),
                ("Duration", f"{(f.get('duration_seconds') or 0):.3f} s"),
                ("Sample rate / channels", f"{f.get('sample_rate')} Hz / {f.get('channels')}"),
                ("Uploaded", f.get("uploaded_at")),
                ("Analysed", result.get("analysed_at")),
                (
                    "Scope",
                    "Entire recording"
                    if scope.get("whole_file")
                    else f"Segment {fmt_time(scope.get('start'))} – {fmt_time(scope.get('end'))}",
                ),
                ("Analysis ID", analysis_id),
            ],
            st,
        )
    )

    findings = result.get("findings", [])
    if peaks:
        regions = [
            (x["start"], x["end"], "synthetic" if x["category"] == "synthetic" else x["severity"]) for x in findings
        ]
        png = visuals.waveform_png(peaks, 1400, 160, regions, float(f.get("duration_seconds") or 1))
        story.append(Spacer(1, 6))
        story.append(Image(io.BytesIO(png), width=170 * mm, height=170 * mm * 160 / 1400))
        story.append(
            _p(
                "Waveform overview. Shaded bands mark findings (red: high, amber: medium, violet: "
                "possible synthetic speech).",
                st["small"],
            )
        )

    story.append(Paragraph("Findings", st["h2"]))
    if not findings:
        story.append(
            _p(
                "No findings reached the reporting threshold. This does not prove that the recording is authentic.",
                st["base"],
            )
        )
    else:
        rows = []
        for x in findings:
            sev = Paragraph(
                f'<font color="{SEV_COLOURS.get(x["severity"], "#5B5869")}"><b>{x["severity"].upper()}</b></font>',
                st["cell"],
            )
            rows.append(
                [
                    x["id"],
                    f"{fmt_time(x['start'])}–{fmt_time(x['end'])}",
                    x["label"],
                    sev,
                    f"{x['score']:.2f}",
                    ", ".join(x["families"].keys()),
                ]
            )
        story.append(
            _grid(
                ["ID", "Time", "Label", "Severity", "Score", "Evidence families"],
                rows,
                [14 * mm, 38 * mm, 40 * mm, 18 * mm, 14 * mm, 46 * mm],
                st,
            )
        )
        story.append(
            _p(
                "Score: fused evidence strength in [0, 1] from the calibrated detector mappings. It is "
                "not the probability that the recording was manipulated. No finding is a confirmed "
                "manipulation.",
                st["small"],
            )
        )
        for x in findings:
            block = [
                Paragraph(escape(f"{x['id']} · {x['label']} · {fmt_time(x['start'])}–{fmt_time(x['end'])}"), st["h3"])
            ]
            if x.get("related"):
                block.append(
                    _p(
                        f"Matches source audio at {fmt_time(x['related'].get('source_start'))}–"
                        f"{fmt_time(x['related'].get('source_end'))}.",
                        st["base"],
                    )
                )
            for s in x.get("supporting", []):
                block.append(_p(f"• [{s['detector']}, strength {s['strength']:.2f}] {s['explanation']}", st["base"]))
            if x.get("alternatives"):
                block.append(_p("Other possible explanations: " + " ".join(x["alternatives"]), st["small"]))
            story.append(KeepTogether(block))

    obs = result.get("observations", [])
    if obs:
        story.append(Paragraph("Observations below the reporting threshold", st["h3"]))
        story.append(
            _p(
                f"{len(obs)} weaker observation(s) were recorded but are consistent with natural variation "
                "and are not treated as findings: "
                + ", ".join(f"{fmt_time(o['start'])} ({o['score']:.2f})" for o in obs[:20]),
                st["small"],
            )
        )

    story.append(PageBreak())
    story.append(Paragraph("Synthetic-speech detection", st["h2"]))
    synth = result.get("synthetic", {})
    if not synth:
        story.append(_p("Detection model not configured on this server.", st["base"]))
    for det_id, s in synth.items():
        model = s.get("model") or {}
        story.append(Paragraph(escape(model.get("name") or det_id), st["h3"]))
        if s.get("status") != "ok":
            story.append(_p(s.get("status_detail") or "Not run.", st["base"]))
            continue
        cal_note = (
            "Calibrated; may influence the verdict."
            if s.get("use_for_verdict")
            else "Calibrated, reference only (does not influence the verdict)."
            if s.get("calibrated")
            else "Not calibrated: raw model scores shown for reference only."
        )
        story.append(
            _kv_table(
                [
                    ("Model", f"{model.get('architecture')} · {model.get('version')}"),
                    ("Training data", model.get("training_data")),
                    ("Licence", model.get("license")),
                    ("Calibration", cal_note),
                    ("Windows scored", f"{s.get('windows_scored')} of {s.get('windows_total')}"),
                    (
                        "Mean / sustained max probability",
                        f"{s.get('mean_probability', 0):.3f} / {s.get('sustained_max_probability', 0):.3f}",
                    ),
                ],
                st,
            )
        )
        story.append(_window_chart(s.get("windows", []), s.get("thresholds"), s.get("probability_key", "p_model")))
        story.append(
            _p(
                "Probability of synthetic speech per 4 s window ("
                + ("calibrated" if s.get("calibrated") else "uncalibrated model output")
                + ").",
                st["small"],
            )
        )
        prov = s.get("calibration_provenance")
        if prov:
            story.append(
                _p("Calibration data: " + str(prov.get("dataset", "")) + ". " + str(prov.get("note", "")), st["small"])
            )

    story.append(Paragraph("Recording quality", st["h2"]))
    q = result["quality"]
    story.append(
        _kv_table(
            [
                ("Duration / speech", f"{q['duration_seconds']:.1f} s / {q['speech_seconds']:.1f} s"),
                ("Signal-to-noise ratio", f"{q['snr_db']:.1f} dB" if q.get("snr_db") is not None else "—"),
                ("Noise floor", f"{q['noise_floor_dbfs']:.1f} dBFS"),
                ("Clipping", f"{q['clipping_ratio'] * 100:.3f}% of samples"),
                (
                    "Effective bandwidth",
                    f"{q['effective_bandwidth_hz'] / 1000:.1f} kHz" if q.get("effective_bandwidth_hz") else "—",
                ),
            ],
            st,
        )
    )
    for i in q["issues"]:
        story.append(_p(f"• {i['title']} ({i['severity']}): {i['detail']}", st["base"]))

    story.append(Paragraph("Metadata and integrity", st["h2"]))
    md = result["metadata"]
    msum = md["summary"]
    story.append(
        _kv_table(
            [
                ("Container / codec", f"{msum.get('container')} / {msum.get('codec_long') or msum.get('codec')}"),
                ("Bit rate", f"{(msum.get('bit_rate') or 0) / 1000:.0f} kbit/s" if msum.get("bit_rate") else "—"),
                ("Tags", "; ".join(f"{k}={v}" for k, v in (msum.get("tags") or {}).items()) or "None present"),
            ],
            st,
        )
    )
    for m in md["findings"]:
        story.append(_p(f"• {m['title']} ({m['severity']}): {m['detail']}", st["base"]))
    story.append(_p(md["note"], st["small"]))

    story.append(Paragraph("Checks performed", st["h2"]))
    rows = []
    for d in result["detectors"]:
        rows.append(
            [
                d["name"],
                d["kind"],
                d["status"].replace("_", " "),
                d["version"],
                (d.get("status_detail") or d.get("method") or "")[:220],
            ]
        )
    story.append(
        _grid(
            ["Check", "Type", "Status", "Version", "Method / note"],
            rows,
            [38 * mm, 12 * mm, 22 * mm, 22 * mm, 76 * mm],
            st,
        )
    )
    cal = result.get("calibration", {}).get("editing", {})
    story.append(
        _p(
            f"Edit-detection calibration: {cal.get('source', '')} (version {cal.get('version')}). "
            f"{cal.get('note', '') or cal.get('dataset', '')}",
            st["small"],
        )
    )

    story.append(Paragraph("Limitations", st["h2"]))
    for lim in result.get("limitations", []):
        story.append(_p(f"• {lim}", st["base"]))
    story.append(Paragraph("Recommendations", st["h2"]))
    for r in result.get("recommendations", []):
        story.append(_p(f"• {r}", st["base"]))

    if audit_events:
        story.append(Paragraph("Chain of custody", st["h2"]))
        story.append(
            _grid(
                ["Time (UTC)", "Event", "Details"],
                [[e["at"], e["action"], e["details"]] for e in audit_events],
                [42 * mm, 40 * mm, 88 * mm],
                st,
            )
        )

    story.append(Spacer(1, 10))
    story.append(
        _p(
            "Important: this report presents indicators produced by automated signal analysis and machine-learning "
            "models. Indicators are not proof of manipulation, and the absence of indicators is not proof of "
            "authenticity. Conclusions about evidence should be drawn by a qualified examiner who considers the "
            "recording's provenance and context. Audio Sentinel does not identify speakers.",
            st["small"],
        )
    )
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


def build_comparison_report(result: dict, *, comparison_id: str) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title="Audio Sentinel comparison report",
    )
    s = result["summary"]
    story = [Paragraph("Original vs. suspect comparison", st["h1"]), Spacer(1, 6)]
    for label, f in (("Alleged original", result.get("original", {})), ("Suspect version", result.get("suspect", {}))):
        story.append(Paragraph(label, st["h2"]))
        story.append(
            _kv_table(
                [
                    ("File", f.get("filename")),
                    ("SHA-256", f.get("sha256")),
                    ("Duration", f"{(f.get('duration_seconds') or 0):.3f} s"),
                    ("Format", f"{f.get('format')} / {f.get('codec')}"),
                ],
                st,
            )
        )
    story.append(Paragraph("Summary (confirmed by direct comparison)", st["h2"]))
    story.append(
        _kv_table(
            [
                ("Shared content", "Yes" if s["shares_content"] else "No / very little"),
                (
                    "Matched",
                    f"{s['matched_fraction_suspect'] * 100:.1f}% of suspect, {s['matched_fraction_original'] * 100:.1f}% of original",
                ),
                ("Duration difference", f"{s['duration_difference_s']:+.3f} s"),
                (
                    "Added / changed / removed",
                    f"{s['added_segments']} / {s['changed_segments']} / {s['removed_segments']}",
                ),
                ("Splice points in suspect", s["splice_points"]),
                (
                    "Level difference (median)",
                    f"{s['median_level_difference_db']:+.1f} dB"
                    if s.get("median_level_difference_db") is not None
                    else "—",
                ),
            ],
            st,
        )
    )
    story.append(Paragraph("Suspect timeline", st["h2"]))
    rows = []
    for t in result["timeline"]:
        if t["type"] == "matched":
            rows.append(
                [
                    t["type"],
                    f"{fmt_time(t['b_start'])}–{fmt_time(t['b_end'])}",
                    f"{fmt_time(t['a_start'])}–{fmt_time(t['a_end'])}",
                    f"{t['similarity']:.3f}",
                    f"{t['level_difference_db']:+.1f} dB",
                ]
            )
        else:
            rows.append(
                [
                    t["type"],
                    f"{fmt_time(t['b_start'])}–{fmt_time(t['b_end'])}",
                    f"{fmt_time(t.get('a_start'))}–{fmt_time(t.get('a_end'))}" if t.get("a_start") is not None else "—",
                    "—",
                    t.get("content", ""),
                ]
            )
    story.append(
        _grid(
            ["Type", "Suspect time", "Original time", "Similarity", "Note"],
            rows,
            [22 * mm, 40 * mm, 40 * mm, 22 * mm, 46 * mm],
            st,
        )
    )
    if result["removed"]:
        story.append(Paragraph("Original material not found in suspect", st["h2"]))
        story.append(
            _grid(
                ["Original time", "Duration", "Content"],
                [
                    [f"{fmt_time(r['a_start'])}–{fmt_time(r['a_end'])}", f"{r['duration_s']:.2f} s", r["kind"]]
                    for r in result["removed"]
                ],
                [60 * mm, 40 * mm, 70 * mm],
                st,
            )
        )
    if result["splice_points"]:
        story.append(Paragraph("Splice points", st["h2"]))
        story.append(
            _grid(
                ["Suspect time", "Kind", "Original jumps from → to"],
                [
                    [fmt_time(p["b_time"]), p["kind"], f"{fmt_time(p['a_from'])} → {fmt_time(p['a_to'])}"]
                    for p in result["splice_points"]
                ],
                [40 * mm, 40 * mm, 90 * mm],
                st,
            )
        )
    story.append(Paragraph("Notes", st["h2"]))
    for n in result["notes"]:
        story.append(_p(f"• {n}", st["base"]))
    story.append(_p(f"Comparison {comparison_id} · {result.get('method')}", st["small"]))
    doc.build(story)
    return buf.getvalue()
