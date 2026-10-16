import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, Cpu, Database, ExternalLink, Gauge, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBox, KV, PageHeader, PageLoader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { fmtDate, fmtPct, fmtRelative } from "@/lib/format";
import type { DetectorStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FAMILY_LABEL } from "@/lib/verdict";

function StateIcon({ state }: { state: string }) {
  if (state === "ready") return <CheckCircle2 className="size-4 text-ok" />;
  if (state === "not_configured") return <CircleDashed className="size-4 text-sev-medium" />;
  return <XCircle className="size-4 text-sev-high" />;
}

type Dict = Record<string, unknown>;
const num = (v: unknown, d = 3) => (typeof v === "number" ? v.toFixed(d) : "—");
const pct = (v: unknown, d = 1) => (typeof v === "number" ? fmtPct(v, d) : "—");

function MetricTable({ rows, cols }: { rows: Dict[]; cols: [string, string, (v: unknown) => ReactNode][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[12.5px]">
        <thead className="text-[11px] uppercase tracking-wide text-faint">
          <tr className="border-b border-line">{cols.map(([, h]) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60">
              {cols.map(([k, h, f]) => <td key={h} className="tabular py-2 pr-4 text-ink-soft">{f(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetectorCard({ d }: { d: DetectorStatus }) {
  const cal = d.calibration;
  const m = (cal.metrics ?? {}) as Dict;
  const test = (m.test ?? m) as Dict;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StateIcon state={d.state} />
            <CardTitle>{d.name}</CardTitle>
          </div>
          <CardDescription>{d.architecture}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge className={cn(d.state === "ready" ? "text-ok" : "text-sev-medium")}>
            {d.state === "ready" ? "Ready" : d.state === "not_configured" ? "Not configured" : "Unavailable"}
          </Badge>
          {!d.enabled && <Badge>Disabled</Badge>}
          {cal.use_for_verdict ? <Badge className="text-ok">Used for verdicts</Badge> : <Badge>Reference only</Badge>}
        </div>
      </CardHeader>
      <CardBody>
        {d.detail && (
          <p className="mb-4 flex gap-2 rounded-lg border border-sev-medium/30 bg-sev-medium-bg/50 px-3 py-2 text-[12.5px] text-sev-medium">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{d.detail}
          </p>
        )}
        <dl>
          <KV k="Training data" v={<span className="text-[12px]">{d.training_data}</span>} />
          <KV k="Licence" v={<span>{d.license}{!d.commercial_use && <span className="ml-1 text-sev-medium">(non-commercial)</span>}</span>} />
          <KV k="Version" v={<span className="font-mono text-[11.5px]">{d.version}</span>} />
          <KV k="Paper" v={<span className="text-[12px]">{d.paper}</span>} />
          <KV k="Source" v={<a href={d.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-soft hover:underline">model card <ExternalLink className="size-3" /></a>} />
        </dl>
        <h4 className="eyebrow mt-5">Published results (from the authors or third parties)</h4>
        <MetricTable rows={d.published_results as unknown as Dict[]} cols={[["dataset", "Dataset", (v) => String(v)], ["eer_percent", "EER", (v) => (v != null ? `${v}%` : "—")], ["source", "Source", (v) => String(v)]]} />
        <h4 className="eyebrow mt-5">Calibration on this server</h4>
        {cal.calibrated ? (
          <div className="mt-2">
            <dl>
              <KV k="Dataset" v={<span className="text-[12px]">{String((cal.provenance as Dict)?.dataset ?? "—")}</span>} />
              <KV k="Thresholds (possible / strong)" v={cal.thresholds ? `${cal.thresholds.possible.toFixed(3)} / ${cal.thresholds.strong.toFixed(3)}` : "—"} />
              <KV k="Held-out EER" v={pct(test.eer)} />
              <KV k="ROC AUC" v={num(test.auc)} />
              <KV k="At 'possible': TPR / FPR" v={`${pct((test.at_possible as Dict)?.tpr)} / ${pct((test.at_possible as Dict)?.fpr)}`} />
              <KV k="At 'strong': TPR / FPR" v={`${pct((test.at_strong as Dict)?.tpr)} / ${pct((test.at_strong as Dict)?.fpr)}`} />
              <KV k="Calibrated" v={cal.created_at ? fmtDate(cal.created_at) : "—"} />
            </dl>
            {Array.isArray(test.by_condition) && (
              <div className="mt-3">
                <MetricTable rows={test.by_condition as Dict[]} cols={[["condition", "Condition", (v) => String(v)], ["eer", "EER", (v) => pct(v)], ["fpr_possible", "FPR @ possible", (v) => pct(v)], ["tpr_possible", "TPR @ possible", (v) => pct(v)]]} />
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted">{cal.note ?? "Not calibrated."}</p>
        )}
        {d.notes.length > 0 && (
          <ul className="mt-4 space-y-1 text-[12px] leading-relaxed text-muted">{d.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
        )}
      </CardBody>
    </Card>
  );
}

export default function SystemStatus() {
  const q = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 15_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox>{(q.error as Error).message}</ErrorBox>;
  const s = q.data!;
  const evalEdit = (s.evaluation?.edit_detection ?? null) as Dict | null;
  const editTest = (evalEdit?.test ?? null) as Dict | null;
  const prov = s.calibration.editing.provenance;

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow="Models & system" title="Detection capabilities">
        What this server can actually run, which models and versions are installed, how they were calibrated and how they performed on held-out evaluation data.
      </PageHeader>

      <div className="mb-6 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-4">
        {[
          [<Cpu key="a" className="size-4" />, "Analysis workers", `${s.workers_online} online`],
          [<Gauge key="b" className="size-4" />, "Queue", `${s.queue.counts.queued ?? 0} queued · ${s.queue.counts.running ?? 0} running`],
          [<Database key="c" className="size-4" />, "Storage", `${s.storage.backend} · encrypted`],
          [<CheckCircle2 key="d" className="size-4" />, "Pipeline", s.pipeline_version],
        ].map(([icon, k, v], i) => (
          <div key={i} className="bg-surface px-5 py-4">
            <div className="flex items-center gap-2 text-[12px] text-muted">{icon}{k}</div>
            <div className="mt-1.5 text-[15px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {s.workers_online === 0 && (
        <ErrorBox className="mb-6">No analysis worker is online. Start one with <code className="font-mono">python -m app.jobs.worker</code>; queued analyses will run when it connects.</ErrorBox>
      )}

      <h2 className="mb-3 text-[15px] font-semibold">Synthetic-speech detectors</h2>
      <p className="mb-4 text-[12.5px] text-muted">Status {s.synthetic_source}.</p>
      <div className="mb-8 grid gap-5 xl:grid-cols-2">
        {s.synthetic_detectors.length === 0 ? (
          <Card className="p-5 text-sm text-muted">Detection model not configured: no synthetic-speech detector is registered.</Card>
        ) : (
          s.synthetic_detectors.map((d) => <DetectorCard key={d.id} d={d} />)
        )}
      </div>

      <h2 className="mb-3 text-[15px] font-semibold">Signal-processing checks</h2>
      <Card className="mb-8">
        <CardBody>
          <ul className="divide-y divide-line">
            {s.signal_checks.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex w-64 shrink-0 items-center gap-2"><StateIcon state={c.state} /><span className="text-[13.5px] font-medium">{c.name}</span></div>
                <div className="flex-1 text-[12.5px] leading-relaxed text-muted">{c.description}</div>
                <Badge className="shrink-0">{FAMILY_LABEL[c.family] ?? c.family}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border border-line bg-elevated px-4 py-3 text-[12.5px] leading-relaxed text-muted">
            <span className="font-medium text-ink">Threshold calibration:</span> {String(prov.source ?? "")} · version {s.calibration.editing.version}.{" "}
            {String(prov.note ?? prov.dataset ?? "")}
            {prov.validated === false && <span className="text-sev-medium"> Not validated on an evaluation set.</span>}
          </div>
        </CardBody>
      </Card>

      <h2 className="mb-3 text-[15px] font-semibold">Evaluation</h2>
      {!s.evaluation ? (
        <Card className="mb-8 p-5 text-[13px] text-muted">No evaluation summary is installed on this server. Run the evaluation suite (see <code className="font-mono">evaluation/README.md</code>) to measure performance on held-out data.</Card>
      ) : (
        <div className="mb-8 space-y-5">
          {editTest && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Edit & splice detection</CardTitle>
                  <CardDescription>{String(evalEdit?.dataset ?? "")}</CardDescription>
                </div>
              </CardHeader>
              <CardBody>
                <dl className="grid gap-x-10 sm:grid-cols-2">
                  <div>
                    <KV k="Test files (edited / unedited)" v={`${editTest.edited_files ?? "—"} / ${editTest.unedited_files ?? "—"}`} />
                    <KV k="Boundary recall (finding within ±0.5 s)" v={pct((editTest.overall as Dict)?.recall)} />
                    <KV k="Finding precision" v={pct((editTest.overall as Dict)?.precision)} />
                  </div>
                  <div>
                    <KV k="False findings per 10 min of unedited audio" v={num((editTest.overall as Dict)?.false_findings_per_10min, 2)} />
                    <KV k="File-level false-positive rate" v={pct((editTest.overall as Dict)?.file_fpr)} />
                    <KV k="File-level false-negative rate" v={pct((editTest.overall as Dict)?.file_fnr)} />
                  </div>
                </dl>
                {Array.isArray(editTest.by_manipulation) && (
                  <div className="mt-5">
                    <MetricTable rows={editTest.by_manipulation as Dict[]} cols={[["type", "Manipulation", (v) => String(v)], ["n", "Files", (v) => String(v)], ["recall", "Recall", (v) => pct(v)], ["median_localization_error_s", "Median loc. error", (v) => (typeof v === "number" ? `${v.toFixed(2)} s` : "—")]]} />
                  </div>
                )}
                {Array.isArray(editTest.by_condition) && (
                  <div className="mt-5">
                    <MetricTable rows={editTest.by_condition as Dict[]} cols={[["condition", "Condition", (v) => String(v)], ["recall", "Recall", (v) => pct(v)], ["false_findings_per_10min", "False / 10 min", (v) => num(v, 2)], ["file_fpr", "File FPR", (v) => pct(v)]]} />
                  </div>
                )}
                {typeof evalEdit?.limitations === "string" && <p className="mt-4 text-[12px] leading-relaxed text-muted">{evalEdit.limitations}</p>}
              </CardBody>
            </Card>
          )}
          <p className="text-[12px] text-faint">Evaluation generated {fmtRelative(String(s.evaluation.generated_at ?? ""))}. Accuracy figures apply to the documented evaluation data only.</p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Limits & retention</CardTitle></CardHeader>
          <CardBody>
            <dl>
              <KV k="Maximum upload" v={`${s.limits.max_upload_mb} MB`} />
              <KV k="Maximum duration" v={`${s.limits.max_duration_minutes} min`} />
              <KV k="Formats" v={<span className="text-[12px]">{s.limits.formats}</span>} />
              <KV k="Default retention" v={`${s.retention.default_days} days (max ${s.retention.max_days})`} />
              <KV k="Reports stored on server" v={s.retention.reports_stored ? "Yes" : "No (generated on demand)"} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Infrastructure</CardTitle></CardHeader>
          <CardBody>
            <dl>
              <KV k="Environment" v={s.environment} />
              <KV k="Encryption" v={<span className="text-[12px]">{s.storage.encryption}</span>} />
              <KV k="Public file URLs" v={s.storage.public_urls ? "Yes" : "None"} />
              <KV k="Rate limiting" v={`${s.rate_limiting.enabled ? "On" : "Off"} (${s.rate_limiting.backend})`} />
              <KV k="FFmpeg" v={<span className="font-mono text-[11px]">{s.ffmpeg}</span>} />
            </dl>
            {s.workers.length > 0 && (
              <ul className="mt-3 space-y-1 text-[12px] text-muted">
                {s.workers.map((w) => <li key={w.id}>{w.online ? "●" : "○"} {w.id} · seen {fmtRelative(w.last_seen_at)}</li>)}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
