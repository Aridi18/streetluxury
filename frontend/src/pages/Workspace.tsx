import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FlaskConical, Hash, ScanSearch, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { JobStatusPill, VerdictBadge } from "@/components/Badges";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorBox, PageLoader, Spinner } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { FindingDetail, FindingsList, ObservationsList } from "@/components/workspace/Findings";
import { ForensicTimeline, type TimelineHandle } from "@/components/workspace/ForensicTimeline";
import { api } from "@/lib/api";
import { fmtBytes, fmtDate, fmtDuration, fmtHz, fmtTime, shortHash } from "@/lib/format";
import type { Analysis, AnalysisResult, Finding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SOURCE_LABEL, VERDICT_STYLE, VERDICT_TEXT } from "@/lib/verdict";

function primarySynthetic(result: AnalysisResult | null | undefined) {
  if (!result) return null;
  const entries = Object.entries(result.synthetic ?? {}).filter(([, v]) => v.status === "ok");
  const voting = entries.find(([, v]) => v.use_for_verdict);
  const pick = voting ?? entries.find(([k]) => k.startsWith("antideepfake")) ?? entries[0];
  return pick ? { id: pick[0], ...pick[1] } : null;
}

function AssessmentPanel({ a }: { a: Analysis }) {
  const r = a.result!;
  const s = VERDICT_STYLE[r.overall.status];
  return (
    <div className="space-y-5 animate-fade-in">
      <div className={cn("rounded-xl px-4 py-3.5 ring-1 ring-inset", s.bg, s.ring)}>
        <div className="eyebrow mb-1">Overall assessment</div>
        <div className={cn("text-[15.5px] font-semibold", s.fg)}>{VERDICT_TEXT[r.overall.status]}</div>
        {r.overall.caveats.map((c) => (
          <p key={c} className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{c}</p>
        ))}
      </div>
      {(["editing", "synthetic"] as const).map((k) => (
        <div key={k}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-medium">{k === "editing" ? "Editing & splicing" : "Synthetic speech"}</div>
            <VerdictBadge status={r.assessments[k].status} />
          </div>
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-muted">
            {r.assessments[k].reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      ))}
      <div>
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium">Recording quality</div>
          <Badge className={cn(r.quality.overall === "poor" && "text-sev-high", r.quality.overall === "fair" && "text-sev-medium")}>{r.quality.overall}</Badge>
        </div>
        <div className="mt-1.5 text-[12.5px] text-muted">
          {r.quality.snr_db != null && `SNR ${r.quality.snr_db.toFixed(0)} dB · `}
          {r.quality.speech_seconds.toFixed(1)} s speech
          {r.quality.effective_bandwidth_hz ? ` · bandwidth ${fmtHz(r.quality.effective_bandwidth_hz)}` : ""}
        </div>
        {r.quality.issues.filter((i) => i.severity !== "info").map((i) => (
          <div key={i.code} className="mt-1.5 text-[12.5px] text-sev-medium">{i.title}</div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Link to={`/app/analyses/${a.id}`} className={buttonVariants({ size: "sm" })}>
          <FileText /> Full report
        </Link>
        <a href={api.reportUrl(a.id)} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          <Download /> PDF
        </a>
      </div>
    </div>
  );
}

export default function Workspace() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const timeline = useRef<TimelineHandle>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runSynthetic, setRunSynthetic] = useState(true);
  const [time, setTime] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rec = useQuery({
    queryKey: ["recording", id],
    queryFn: () => api.recording(id),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 1500 : false),
  });
  const ready = rec.data?.status === "ready" && rec.data.has_audio;
  const peaks = useQuery({ queryKey: ["peaks", id], queryFn: () => api.peaks(id), enabled: !!ready, staleTime: Infinity });
  const list = useQuery({
    queryKey: ["recording-analyses", id],
    queryFn: () => api.recordingAnalyses(id),
    enabled: !!rec.data,
    refetchInterval: (q) => (q.state.data?.items.some((a) => a.status === "queued" || a.status === "running") ? 2000 : false),
  });
  const selectedId = params.get("analysis") ?? list.data?.items[0]?.id ?? null;
  const analysis = useQuery({
    queryKey: ["analysis", selectedId],
    queryFn: () => api.analysis(selectedId!),
    enabled: !!selectedId,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 1200 : false),
  });

  const a = analysis.data;
  const result = a?.status === "succeeded" ? a.result : null;
  const findings = useMemo(() => result?.findings ?? [], [result]);
  const synth = primarySynthetic(result);
  const active = findings.find((f) => f.id === activeId) ?? null;

  useEffect(() => {
    if (a && a.status === "succeeded") qc.invalidateQueries({ queryKey: ["recording-analyses", id] });
  }, [a?.status, id, qc]);

  const start = useMutation({
    mutationFn: (sel: { start?: number; end?: number }) => api.analyse(id, { ...sel, run_synthetic: runSynthetic }),
    onSuccess: (an) => {
      setParams({ analysis: an.id });
      setActiveId(null);
      qc.invalidateQueries({ queryKey: ["recording-analyses", id] });
      toast.success("Analysis queued");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelAnalysis(selectedId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analysis", selectedId] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteRecording(id),
    onSuccess: () => {
      toast.success("Recording, analyses and reports deleted");
      qc.invalidateQueries();
      navigate("/app/history");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const selectFinding = (f: Finding) => {
    setActiveId(f.id);
    timeline.current?.seek(f.start);
  };
  const playFinding = (f: Finding) => {
    setActiveId(f.id);
    const pad = 0.75;
    timeline.current?.playRange(Math.max(0, f.start - pad), f.end + pad);
  };

  if (rec.isLoading) return <PageLoader />;
  if (rec.error) return <ErrorBox>{(rec.error as Error).message}</ErrorBox>;
  const r = rec.data!;
  const running = a && (a.status === "queued" || a.status === "running");

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-2">Analysis workspace</div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{r.title || r.original_filename}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge>{SOURCE_LABEL[r.source]}</Badge>
            <Badge>{(r.detected_format ?? "?").toUpperCase()} · {r.codec}</Badge>
            <Badge>{fmtDuration(r.duration_seconds)}</Badge>
            <Badge>{r.sample_rate ? `${fmtHz(r.sample_rate)} · ${r.channels} ch` : "—"}</Badge>
            <Badge>{fmtBytes(r.size_bytes)}</Badge>
            <Tooltip content={<span className="break-all font-mono">SHA-256 {r.sha256}</span>}>
              <button onClick={() => navigator.clipboard?.writeText(r.sha256).then(() => toast.success("SHA-256 copied"))}>
                <Badge className="cursor-copy font-mono"><Hash className="size-3" />{shortHash(r.sha256)}</Badge>
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {r.has_audio && (
            <a href={api.downloadUrl(r.id)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Download /> Original file
            </a>
          )}
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>

      {r.status === "processing" && (
        <Card className="flex items-center gap-3 p-5 text-sm text-muted"><Spinner /> Decoding audio and preparing the waveform and spectrogram…</Card>
      )}
      {r.status === "failed" && <ErrorBox>{r.error || "This recording could not be processed."}</ErrorBox>}
      {r.audio_purged_at && (
        <Card className="mb-5 p-4 text-[13px] text-muted">
          The audio was deleted on {fmtDate(r.audio_purged_at)} (retention policy or your request). Earlier results remain available
          until you delete them; playback and new analyses are not possible.
        </Card>
      )}

      {r.status === "ready" && (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              {list.data && list.data.items.length > 0 ? (
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    setParams({ analysis: e.target.value });
                    setActiveId(null);
                  }}
                  className="h-9 min-w-0 max-w-full rounded-lg border border-line-strong bg-elevated px-3 text-[13px] text-ink"
                  aria-label="Select analysis"
                >
                  {list.data.items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {fmtDate(x.created_at)} · {x.segment_start != null ? `segment ${fmtTime(x.segment_start, false)}–${fmtTime(x.segment_end, false)}` : "entire recording"} · {x.status === "succeeded" ? (x.verdict ?? "") : x.status}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[13px] text-muted">No analysis yet. Analyse the whole recording, or drag on the waveform to select a segment.</span>
              )}
              {a && <JobStatusPill status={a.status} stage={a.stage} />}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                <Switch checked={runSynthetic} onCheckedChange={setRunSynthetic} label="Include synthetic-speech models" />
                Synthetic-speech models
              </label>
              {selection && (
                <Button variant="secondary" size="sm" onClick={() => start.mutate({ start: selection.start, end: selection.end })} disabled={!r.has_audio || start.isPending || selection.end - selection.start < 1}>
                  <ScanSearch /> Analyse selection ({fmtTime(selection.start, false)}–{fmtTime(selection.end, false)})
                </Button>
              )}
              {selection && (
                <Button variant="ghost" size="icon-sm" onClick={() => setSelection(null)} aria-label="Clear selection"><X /></Button>
              )}
              <Button size="sm" onClick={() => start.mutate({})} disabled={!r.has_audio || start.isPending}>
                {start.isPending ? <Spinner className="text-white" /> : <FlaskConical />} Analyse entire recording
              </Button>
            </div>
          </Card>

          {running && (
            <Card className="mb-4 p-4">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink-soft">{a.stage || "Working…"}</span>
                <div className="flex items-center gap-3">
                  <span className="tabular text-muted">{Math.round(a.progress * 100)}%</span>
                  <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</Button>
                </div>
              </div>
              <Progress value={a.progress} className="mt-2.5" />
            </Card>
          )}
          {a?.status === "failed" && <ErrorBox className="mb-4">Analysis failed: {a.error}</ErrorBox>}

          {r.has_audio && peaks.data ? (
            <ForensicTimeline
              ref={timeline}
              audioUrl={api.audioUrl(r.id)}
              peaks={peaks.data.peaks}
              duration={peaks.data.duration}
              tiles={r.spectrogram?.tiles ?? []}
              tileUrl={(i) => api.tileUrl(r.id, i)}
              maxFreqHz={r.spectrogram?.max_freq_hz ?? (r.sample_rate ?? 16000) / 2}
              findings={findings}
              activeFindingId={activeId}
              onFindingClick={(fid) => setActiveId(fid)}
              syntheticWindows={synth?.windows}
              syntheticKey={synth?.probability_key}
              syntheticThresholds={synth?.thresholds}
              selection={selection}
              onSelection={setSelection}
              onTime={setTime}
            />
          ) : r.has_audio ? (
            <Card className="flex h-64 items-center justify-center gap-2 text-sm text-muted"><Spinner /> Loading waveform…</Card>
          ) : null}
          {result && !result.scope.whole_file && (
            <p className="mt-2 text-[12px] text-muted">
              This analysis covers {fmtTime(result.scope.start)} – {fmtTime(result.scope.end)} only.
            </p>
          )}
        </>
      )}

      {result && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card className="overflow-hidden">
            <Tabs defaultValue="findings">
              <div className="px-4 pt-2">
                <TabsList className="border-0">
                  <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
                  <TabsTrigger value="observations">Below threshold ({result.observations.length})</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="findings" className="border-t border-line pt-0">
                {findings.length === 0 ? (
                  <div className="p-5">
                    <EmptyState title="No findings above the reporting threshold">
                      The applicable checks found no evidence strong enough to report. This does not prove the recording
                      is authentic. Review the assessment for coverage and limitations.
                    </EmptyState>
                  </div>
                ) : (
                  <FindingsList findings={findings} activeId={activeId} onSelect={selectFinding} onPlay={playFinding} playheadTime={time} />
                )}
              </TabsContent>
              <TabsContent value="observations" className="border-t border-line pt-0">
                <p className="px-4 py-3 text-[12.5px] leading-relaxed text-muted">
                  Weaker observations that did not reach the reporting threshold (score {result.thresholds.report.toFixed(2)}).
                  They are consistent with natural variation and are listed for transparency only.
                </p>
                <ObservationsList items={result.observations} onSelect={(o) => timeline.current?.focus(o.start, o.end)} />
              </TabsContent>
            </Tabs>
          </Card>
          <Card className="p-5">
            {active ? (
              <>
                <button onClick={() => setActiveId(null)} className="mb-3 text-[12.5px] text-accent-soft hover:underline">← Assessment</button>
                <FindingDetail f={active} onPlay={() => playFinding(active)} onFocus={() => timeline.current?.focus(active.start, active.end)} />
              </>
            ) : (
              <AssessmentPanel a={a!} />
            )}
          </Card>
        </div>
      )}

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this recording?"
        description="The audio, its derived files, all analyses and comparisons that use it are permanently deleted. Downloaded reports are not affected."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep</Button>
          <Button variant="danger" onClick={() => del.mutate()} disabled={del.isPending}>
            {del.isPending && <Spinner />} Delete permanently
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
