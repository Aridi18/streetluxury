import { useQuery } from "@tanstack/react-query";
import { ArrowRight, AudioLines, GitCompareArrows, Mic, Upload } from "lucide-react";
import { Link } from "react-router";
import { JobStatusPill, VerdictBadge } from "@/components/Badges";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorBox, PageHeader, PageLoader } from "@/components/ui/misc";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { fmtDuration, fmtRelative, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { user } = useAuth();
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    refetchInterval: (q) => ((q.state.data?.active_jobs ?? 0) > 0 ? 3000 : false),
  });
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, staleTime: 30_000 });

  if (dash.isLoading) return <PageLoader />;
  if (dash.error) return <ErrorBox>{(dash.error as Error).message}</ErrorBox>;
  const d = dash.data!;
  const synth = sys.data?.synthetic_detectors ?? [];
  const verdictReady = synth.some((s) => s.enabled && s.state === "ready" && s.calibration.use_for_verdict);
  const anyModelReady = synth.some((s) => s.enabled && s.state === "ready");

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome${user?.display_name ? `, ${user.display_name}` : ""}`}
        actions={
          <>
            <Link to="/app/compare" className={buttonVariants({ variant: "secondary" })}>
              <GitCompareArrows /> Compare recordings
            </Link>
            <Link to="/app/new" className={buttonVariants()}>
              <Upload /> New analysis
            </Link>
          </>
        }
      >
        Upload or record audio, examine it on the forensic timeline and export a report.
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-4">
        {[
          ["Recordings", d.recordings],
          ["Analyses", d.analyses],
          ["Comparisons", d.comparisons],
          ["Running now", d.active_jobs],
        ].map(([k, v]) => (
          <div key={k as string} className="bg-surface px-5 py-4">
            <div className="text-[12px] text-muted">{k}</div>
            <div className="tabular mt-1 text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      {sys.data && (
        <div
          className={cn(
            "mb-6 flex flex-col gap-2 rounded-[14px] border px-5 py-3.5 text-[13px] sm:flex-row sm:items-center sm:justify-between",
            verdictReady ? "border-line bg-surface text-ink-soft" : "border-sev-medium/30 bg-sev-medium-bg/60 text-sev-medium",
          )}
        >
          <span>
            {sys.data.workers_online === 0
              ? "No analysis worker is online. Uploads are stored, but analyses will wait in the queue."
              : verdictReady
                ? "Analysis worker online. Signal checks and a calibrated synthetic-speech detector are available."
                : anyModelReady
                  ? "Synthetic-speech models are installed but none is calibrated for verdicts; their scores are shown for reference only."
                  : "Detection model not configured: synthetic-speech detection is unavailable on this server. Signal checks still run."}
          </span>
          <Link to="/app/system" className="inline-flex items-center gap-1 font-medium text-accent-soft hover:underline">
            System status <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Recent analyses</CardTitle>
            <Link to="/app/history" className="text-[13px] text-accent-soft hover:underline">View all</Link>
          </CardHeader>
          <CardBody className="px-0 pb-2">
            {d.recent.length === 0 ? (
              <div className="px-5 pb-4">
                <EmptyState icon={<AudioLines />} title="No analyses yet" action={<Link to="/app/new" className={buttonVariants()}>Analyse your first recording</Link>}>
                  Upload a file, a messaging-app voice note, or record with your microphone.
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {d.recent.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={a.status === "succeeded" ? `/app/analyses/${a.id}` : `/app/recordings/${a.recording_id}?analysis=${a.id}`}
                      className="flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-elevated sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium">{a.recording_info?.title || a.recording_info?.original_filename || "Recording"}</div>
                        <div className="mt-0.5 text-[12px] text-muted">
                          {fmtRelative(a.created_at)} ·{" "}
                          {a.segment_start != null ? `segment ${fmtTime(a.segment_start, false)}–${fmtTime(a.segment_end, false)}` : fmtDuration(a.recording_info?.duration_seconds)}
                          {a.status === "succeeded" && ` · ${a.findings_count ?? 0} finding${a.findings_count === 1 ? "" : "s"}`}
                        </div>
                      </div>
                      <div className="shrink-0">{a.status === "succeeded" ? <VerdictBadge status={a.verdict} /> : <JobStatusPill status={a.status} stage={a.stage} />}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Link to="/app/new?mode=upload" className="card group block p-5 transition-colors hover:border-accent/50">
            <Upload className="size-5 text-accent-soft" />
            <div className="mt-3 font-medium">Upload audio</div>
            <p className="mt-1 text-[13px] text-muted">WAV, MP3, M4A/AAC, OGG/Opus, FLAC and voice notes.</p>
          </Link>
          <Link to="/app/new?mode=record" className="card group block p-5 transition-colors hover:border-accent/50">
            <Mic className="size-5 text-accent-soft" />
            <div className="mt-3 font-medium">Record with microphone</div>
            <p className="mt-1 text-[13px] text-muted">Capture audio directly in the browser.</p>
          </Link>
          <Link to="/app/compare" className="card group block p-5 transition-colors hover:border-accent/50">
            <GitCompareArrows className="size-5 text-accent-soft" />
            <div className="mt-3 font-medium">Compare original vs. edited</div>
            <p className="mt-1 text-[13px] text-muted">Find added, removed and re-ordered audio.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
