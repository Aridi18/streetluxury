import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, AudioWaveform, Download, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { JobStatusPill, ScoreBar, SeverityBadge, VerdictBadge } from "@/components/Badges";
import { WindowChart } from "@/components/WindowChart";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBox, KV, PageLoader } from "@/components/ui/misc";
import { detectorLabel } from "@/components/workspace/Findings";
import { api } from "@/lib/api";
import { fmtBytes, fmtDate, fmtDuration, fmtHz, fmtPct, fmtTime } from "@/lib/format";
import type { AnalysisResult, SyntheticDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FAMILY_LABEL, SOURCE_LABEL, VERDICT_STYLE, VERDICT_TEXT } from "@/lib/verdict";

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </section>
  );
}

function SyntheticCard({ id, d, duration }: { id: string; d: SyntheticDetail; duration: number }) {
  const m = d.model;
  return (
    <div className="rounded-xl border border-line bg-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{m?.name ?? id}</div>
          <div className="mt-0.5 text-[12px] text-muted">{m?.architecture}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.status !== "ok" ? (
            <Badge className="text-muted">{d.status === "skipped" ? "Not configured" : d.status.replace("_", " ")}</Badge>
          ) : d.use_for_verdict ? (
            <Badge className="text-ok">Calibrated · used for verdict</Badge>
          ) : d.calibrated ? (
            <Badge className="text-ink-soft">Calibrated · reference only</Badge>
          ) : (
            <Badge className="text-sev-medium">Uncalibrated · reference only</Badge>
          )}
          {m && !m.commercial_use && <Badge className="text-sev-medium">Non-commercial licence</Badge>}
        </div>
      </div>
      {d.status !== "ok" ? (
        <p className="mt-3 text-[13px] text-muted">{d.status_detail}</p>
      ) : (
        <>
          <div className="mt-4">
            <WindowChart windows={d.windows ?? []} duration={duration} pKey={d.probability_key ?? "p_model"} thresholds={d.thresholds} />
          </div>
          <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
            <dl>
              <KV k="Windows scored" v={`${d.windows_scored} of ${d.windows_total}`} />
              <KV k={d.calibrated ? "Mean calibrated probability" : "Mean model output"} v={d.mean_probability?.toFixed(3)} />
              <KV k="Sustained maximum (2 windows)" v={d.sustained_max_probability?.toFixed(3)} />
              {d.thresholds && <KV k="Thresholds (possible / strong)" v={`${d.thresholds.possible.toFixed(2)} / ${d.thresholds.strong.toFixed(2)}`} />}
            </dl>
            <dl>
              <KV k="Training data" v={<span className="text-[12px]">{m?.training_data}</span>} />
              <KV k="Licence" v={m?.license} />
              <KV k="Version" v={<span className="font-mono text-[11.5px]">{m?.version}</span>} />
            </dl>
          </div>
          {!d.calibrated && (
            <p className="mt-3 flex gap-2 rounded-lg border border-sev-medium/30 bg-sev-medium-bg/50 px-3 py-2 text-[12.5px] text-sev-medium">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Raw model output without validated calibration for this deployment. It is shown for reference and does not affect the verdict.
            </p>
          )}
          {d.calibration_provenance && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Calibration: {String((d.calibration_provenance as Record<string, unknown>).dataset ?? "")}{" "}
              {String((d.calibration_provenance as Record<string, unknown>).note ?? "")}
            </p>
          )}
          {m && m.published_results.length > 0 && (
            <div className="mt-3 text-[12px] text-muted">
              Published results:{" "}
              {m.published_results.map((p) => `${p.dataset} EER ${p.eer_percent}% (${p.source})`).join(" · ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const NAV = [
  ["file", "File"],
  ["assessment", "Assessment"],
  ["intervals", "Suspicious intervals"],
  ["synthetic", "Synthetic speech"],
  ["editing", "Editing checks"],
  ["quality", "Quality"],
  ["metadata", "Metadata"],
  ["method", "Method & limitations"],
  ["recommendations", "Recommendations"],
];

export default function Report() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["analysis", id],
    queryFn: () => api.analysis(id),
    refetchInterval: (s) => (s.state.data && ["queued", "running"].includes(s.state.data.status) ? 1500 : false),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox>{(q.error as Error).message}</ErrorBox>;
  const a = q.data!;
  if (a.status !== "succeeded" || !a.result) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <JobStatusPill status={a.status} stage={a.stage} />
          <span className="text-sm text-muted">{a.status === "failed" ? a.error : a.stage}</span>
        </div>
        <Link to={`/app/recordings/${a.recording_id}?analysis=${a.id}`} className={buttonVariants({ variant: "secondary", className: "mt-4" })}>Open workspace</Link>
      </Card>
    );
  }
  const r: AnalysisResult = a.result;
  const vs = VERDICT_STYLE[r.overall.status];
  const duration = r.file.duration_seconds;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-2">Forensic report</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{r.file.title || r.file.filename}</h1>
          <div className="mt-1.5 text-[13px] text-muted">
            Analysed {fmtDate(r.analysed_at)} · pipeline {r.pipeline_version} ·{" "}
            {r.scope.whole_file ? "entire recording" : `segment ${fmtTime(r.scope.start)}–${fmtTime(r.scope.end)}`}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/app/recordings/${a.recording_id}?analysis=${a.id}`} className={buttonVariants({ variant: "secondary" })}>
            <AudioWaveform /> Open in workspace
          </Link>
          <a href={api.reportUrl(a.id)} className={buttonVariants()}>
            <Download /> Download PDF
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="sticky top-6 hidden h-fit space-y-0.5 lg:block" aria-label="Report sections">
          {NAV.map(([k, label]) => (
            <a key={k} href={`#${k}`} className="block rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-ink">{label}</a>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">
          <div className={cn("rounded-[14px] px-5 py-5 ring-1 ring-inset", vs.bg, vs.ring)} id="assessment">
            <div className="eyebrow mb-1.5">Overall assessment</div>
            <div className={cn("text-xl font-semibold", vs.fg)}>{VERDICT_TEXT[r.overall.status]}</div>
            {r.overall.caveats.map((c) => <p key={c} className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{c}</p>)}
            <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
              {(["editing", "synthetic"] as const).map((k) => (
                <div key={k}>
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {k === "editing" ? "Editing & splicing indicators" : "Synthetic-speech indicators"}
                    <VerdictBadge status={r.assessments[k].status} />
                  </div>
                  <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-ink-soft/90">
                    {r.assessments[k].reasons.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <Section id="file" title="File information" description="Identity of the examined file. Verify the SHA-256 against your copy to confirm it is the same file.">
            <dl className="grid gap-x-10 sm:grid-cols-2">
              <div>
                <KV k="File name" v={r.file.filename} />
                <KV k="Source" v={SOURCE_LABEL[r.file.source] ?? r.file.source} />
                <KV k="Format / codec" v={`${r.file.format?.toUpperCase()} / ${r.file.codec}`} />
                <KV k="Duration" v={fmtDuration(r.file.duration_seconds)} />
                <KV k="Sample rate / channels" v={`${fmtHz(r.file.sample_rate)} / ${r.file.channels}`} />
              </div>
              <div>
                <KV k="Size" v={fmtBytes(r.file.size_bytes)} />
                <KV k="Bit rate" v={r.file.bit_rate ? `${Math.round(r.file.bit_rate / 1000)} kbit/s` : "—"} />
                <KV k="Uploaded" v={fmtDate(r.file.uploaded_at)} />
                <KV k="Analysis ID" v={<span className="font-mono text-[11.5px]">{a.id}</span>} />
                <KV k="SHA-256" v={r.file.sha256} mono />
              </div>
            </dl>
          </Section>

          <Section
            id="intervals"
            title={`Suspicious intervals (${r.findings.length})`}
            description="Inferred from signal analysis or model inference. None of these is a confirmed manipulation; each lists the evidence and alternative explanations."
          >
            {r.findings.length === 0 ? (
              <p className="text-sm text-muted">No intervals reached the reporting threshold ({r.thresholds.report.toFixed(2)}).</p>
            ) : (
              <div className="space-y-3">
                {r.findings.map((f) => (
                  <div key={f.id} className="rounded-xl border border-line bg-elevated p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11.5px] text-faint">{f.id}</span>
                        <span className="font-medium">{f.label}</span>
                        <SeverityBadge severity={f.severity} synthetic={f.category === "synthetic"} />
                        <span className="tabular font-mono text-[12px] text-muted">{fmtTime(f.start)}–{fmtTime(f.end)}</span>
                      </div>
                      <ScoreBar value={f.score} tone={f.category === "synthetic" ? "synthetic" : f.severity === "high" ? "high" : "medium"} />
                    </div>
                    <ul className="mt-3 space-y-2">
                      {f.supporting.map((s, i) => (
                        <li key={i} className="text-[12.5px] leading-relaxed text-ink-soft">
                          <span className="font-medium text-ink">{s.family === "synthetic" ? s.detector : detectorLabel(s.detector)}</span>
                          <span className="text-faint"> · {FAMILY_LABEL[s.family] ?? s.family} · strength {s.strength.toFixed(2)}</span>
                          <div>{s.explanation}</div>
                        </li>
                      ))}
                    </ul>
                    {f.alternatives.length > 0 && (
                      <p className="mt-3 text-[12px] text-muted">Other possible explanations: {f.alternatives.join(" ")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {r.observations.length > 0 && (
              <p className="mt-4 text-[12.5px] text-muted">
                {r.observations.length} weaker observation(s) below the reporting threshold are consistent with natural variation and are not treated as findings.
              </p>
            )}
          </Section>

          <Section id="synthetic" title="Synthetic-speech indicators" description="Scores from machine-learning detectors over overlapping 4 s windows. Only detectors calibrated on held-out data can influence the verdict. No detector identifies which generator was used.">
            <div className="space-y-4">
              {Object.keys(r.synthetic).length === 0 && <p className="text-sm text-muted">Detection model not configured on this server.</p>}
              {Object.entries(r.synthetic).map(([k, d]) => <SyntheticCard key={k} id={k} d={d} duration={duration} />)}
            </div>
          </Section>

          <Section id="editing" title="Editing & splicing checks" description="Signal-processing checks that ran on this recording, and checks that could not be applied.">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-faint">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-4 font-medium">Check</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Observations</th>
                    <th className="py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {r.detectors.map((d) => (
                    <tr key={d.id} className="border-b border-line/60 align-top">
                      <td className="py-2 pr-4 font-medium text-ink">{d.name}</td>
                      <td className="py-2 pr-4 text-muted">{d.kind === "ml" ? "Model" : "Signal"}</td>
                      <td className={cn("py-2 pr-4", d.status === "ok" ? "text-ok" : d.status === "failed" ? "text-sev-high" : "text-muted")}>
                        {d.status === "ok" ? "Ran" : d.status === "skipped" ? "Not configured" : d.status.replace("_", " ")}
                      </td>
                      <td className="tabular py-2 pr-4 text-muted">{d.n_candidates}</td>
                      <td className="py-2 text-muted">{d.status_detail ?? d.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="quality" title="Quality issues affecting reliability">
            <dl className="grid gap-x-10 sm:grid-cols-2">
              <div>
                <KV k="Speech detected" v={`${r.quality.speech_seconds.toFixed(1)} s (${fmtPct(r.quality.speech_ratio)})`} />
                <KV k="Signal-to-noise ratio" v={r.quality.snr_db != null ? `${r.quality.snr_db.toFixed(1)} dB` : "—"} />
                <KV k="Noise floor" v={`${r.quality.noise_floor_dbfs.toFixed(1)} dBFS`} />
              </div>
              <div>
                <KV k="Clipping" v={fmtPct(r.quality.clipping_ratio, 3)} />
                <KV k="Effective bandwidth" v={fmtHz(r.quality.effective_bandwidth_hz)} />
                <KV k="Peak level" v={`${r.quality.peak_dbfs.toFixed(1)} dBFS`} />
              </div>
            </dl>
            <div className="mt-4 space-y-2">
              {r.quality.issues.length === 0 && <p className="text-sm text-muted">No quality issues detected.</p>}
              {r.quality.issues.map((i) => (
                <div key={i.code} className={cn("flex gap-3 rounded-lg border px-3.5 py-2.5 text-[12.5px]", i.severity === "severe" ? "border-sev-high/30 bg-sev-high-bg/50" : i.severity === "warning" ? "border-sev-medium/30 bg-sev-medium-bg/40" : "border-line bg-elevated")}>
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  <div><span className="font-medium text-ink">{i.title}.</span> <span className="text-ink-soft">{i.detail}</span></div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="metadata" title="Metadata & integrity" description={r.metadata.note}>
            <dl className="grid gap-x-10 sm:grid-cols-2">
              <div>
                <KV k="Container" v={String(r.metadata.summary.container ?? "—")} />
                <KV k="Codec" v={String(r.metadata.summary.codec_long ?? r.metadata.summary.codec ?? "—")} />
                <KV k="Channel layout" v={String(r.metadata.summary.channel_layout ?? "—")} />
              </div>
              <div>
                <KV k="Bits per sample" v={String(r.metadata.summary.bits_per_sample ?? "—")} />
                <KV k="Declared duration" v={r.metadata.summary.container_duration_seconds ? `${Number(r.metadata.summary.container_duration_seconds).toFixed(3)} s` : "—"} />
                <KV k="Tags" v={Object.keys(r.metadata.summary.tags ?? {}).length ? Object.entries(r.metadata.summary.tags ?? {}).map(([k, v]) => `${k}=${v}`).join("; ") : "None present"} />
              </div>
            </dl>
            <div className="mt-4 space-y-2">
              {r.metadata.findings.map((m) => (
                <div key={m.id + m.title} className="rounded-lg border border-line bg-elevated px-3.5 py-2.5 text-[12.5px]">
                  <span className={cn("font-medium", m.severity === "warning" ? "text-sev-medium" : "text-ink")}>{m.title}.</span>{" "}
                  <span className="text-ink-soft">{m.detail}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="method" title="Method, versions & limitations">
            <dl className="grid gap-x-10 sm:grid-cols-2">
              <div>
                <KV k="Pipeline version" v={r.pipeline_version} />
                <KV k="Analysis sample rate" v={fmtHz(r.environment.analysis_sample_rate)} />
                <KV k="Edit calibration" v={`${String(r.calibration.editing.source ?? "")} (${String(r.calibration.editing.version ?? "")})`} />
              </div>
              <div>
                {Object.entries(r.environment.versions).map(([k, v]) => <KV key={k} k={k} v={<span className="font-mono text-[11px]">{v}</span>} />)}
              </div>
            </dl>
            <h4 className="eyebrow mt-6">Limitations</h4>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-soft">
              {r.limitations.map((l) => <li key={l} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />{l}</li>)}
            </ul>
          </Section>

          <Section id="recommendations" title="Recommendations for further verification">
            <ul className="space-y-2 text-[13.5px] leading-relaxed text-ink-soft">
              {r.recommendations.map((x) => <li key={x} className="flex gap-2"><ExternalLink className="mt-1 size-3.5 shrink-0 text-accent-soft" />{x}</li>)}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
