import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Play } from "lucide-react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { JobStatusPill } from "@/components/Badges";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBox, KV, PageHeader, PageLoader } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { fmtPct, fmtTime } from "@/lib/format";
import type { ComparisonResult, ComparisonSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS = {
  matched: "#7c6ab0",
  added: "#fb7185",
  changed: "#fbbf24",
  removed: "#fbbf24",
  pause: "#3a3850",
};

function AlignmentDiagram({ r, onPick, picked }: { r: ComparisonResult; onPick: (s: ComparisonSegment) => void; picked: ComparisonSegment | null }) {
  const W = 1000;
  const H = 190;
  const lane = 26;
  const yA = 30;
  const yB = H - 30 - lane;
  const total = Math.max(r.summary.original_duration_s, r.summary.suspect_duration_s, 0.001);
  const x = (t: number) => 10 + (t / total) * (W - 20);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Alignment between the original and the suspect recording">
      <text x={10} y={yA - 8} fontSize={11} fill="#9592a8">Alleged original</text>
      <text x={10} y={yB + lane + 18} fontSize={11} fill="#9592a8">Suspect</text>
      <rect x={x(0)} y={yA} width={x(r.summary.original_duration_s) - x(0)} height={lane} rx={4} fill="#17171f" stroke="#272733" />
      <rect x={x(0)} y={yB} width={x(r.summary.suspect_duration_s) - x(0)} height={lane} rx={4} fill="#17171f" stroke="#272733" />
      {r.timeline.filter((s) => s.type === "matched").map((s, i) => {
        const active = picked === s;
        return (
          <g key={`m${i}`} className="cursor-pointer" onClick={() => onPick(s)}>
            <polygon
              points={`${x(s.a_start!)},${yA + lane} ${x(s.a_end!)},${yA + lane} ${x(s.b_end)},${yB} ${x(s.b_start)},${yB}`}
              fill={active ? "rgba(196,181,253,0.38)" : "rgba(124,106,176,0.26)"}
              stroke={active ? "#c4b5fd" : "rgba(124,106,176,0.45)"}
              strokeWidth={0.8}
            />
            <rect x={x(s.a_start!)} y={yA} width={Math.max(1, x(s.a_end!) - x(s.a_start!))} height={lane} fill={COLORS.matched} rx={2} />
            <rect x={x(s.b_start)} y={yB} width={Math.max(1, x(s.b_end) - x(s.b_start))} height={lane} fill={COLORS.matched} rx={2} />
          </g>
        );
      })}
      {r.timeline.filter((s) => s.type !== "matched").map((s, i) => (
        <rect key={`g${i}`} x={x(s.b_start)} y={yB} width={Math.max(2, x(s.b_end) - x(s.b_start))} height={lane} rx={2}
          fill={s.type === "changed" ? COLORS.changed : s.content === "pause_or_silence" ? COLORS.pause : COLORS.added}
          className="cursor-pointer" onClick={() => onPick(s)}>
          <title>{`${s.type} ${fmtTime(s.b_start)}–${fmtTime(s.b_end)}`}</title>
        </rect>
      ))}
      {r.removed.map((m, i) => (
        <rect key={`r${i}`} x={x(m.a_start)} y={yA} width={Math.max(2, x(m.a_end) - x(m.a_start))} height={lane} rx={2}
          fill={m.kind === "speech" ? COLORS.removed : COLORS.pause} opacity={0.9}>
          <title>{`Not found in suspect: ${fmtTime(m.a_start)}–${fmtTime(m.a_end)}`}</title>
        </rect>
      ))}
      {r.splice_points.map((p, i) => (
        <g key={`s${i}`}>
          <line x1={x(p.b_time)} x2={x(p.b_time)} y1={yB - 6} y2={yB + lane + 6} stroke="#f4f3f8" strokeWidth={1.5} />
          <circle cx={x(p.b_time)} cy={yB - 8} r={3} fill="#f4f3f8" />
        </g>
      ))}
    </svg>
  );
}

const KIND_TEXT: Record<string, string> = {
  removed: "Original audio removed here",
  inserted: "Audio inserted here",
  replaced: "Audio replaced here",
  reordered: "Content re-ordered here",
  timing_shift: "Timing shift",
};

export default function ComparisonView() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["comparison", id],
    queryFn: () => api.comparison(id),
    refetchInterval: (s) => (s.state.data && ["queued", "running"].includes(s.state.data.status) ? 1500 : false),
  });
  const audioA = useRef<HTMLAudioElement>(null);
  const audioB = useRef<HTMLAudioElement>(null);
  const [picked, setPicked] = useState<ComparisonSegment | null>(null);

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorBox>{(q.error as Error).message}</ErrorBox>;
  const c = q.data!;
  const r = c.result;

  const cue = (el: HTMLAudioElement | null, t?: number) => {
    if (!el || t == null) return;
    el.currentTime = t;
  };
  const pick = (s: ComparisonSegment) => {
    setPicked(s);
    cue(audioB.current, s.b_start);
    cue(audioA.current, s.a_start);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Comparison"
        title={`${c.original_info?.title || c.original_info?.original_filename} → ${c.suspect_info?.title || c.suspect_info?.original_filename}`}
        actions={c.status === "succeeded" ? <a href={api.comparisonReportUrl(c.id)} className={buttonVariants()}><Download /> Download PDF</a> : undefined}
      />
      {c.status !== "succeeded" && (
        <Card className="p-5">
          <div className="flex items-center gap-3"><JobStatusPill status={c.status} stage={c.stage} /><span className="text-sm text-muted">{c.error || c.stage}</span></div>
          {(c.status === "running" || c.status === "queued") && <Progress value={c.progress} className="mt-4" />}
        </Card>
      )}
      {r && (
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-[14px] border border-ok/25 bg-ok-bg/50 px-5 py-4 text-[13.5px] text-ink-soft">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
            <div>
              <span className="font-medium text-ok">Confirmed by direct comparison.</span> These differences were measured between
              the two files. They are not inferred by a model. The comparison does not show which file came first.
              {!r.summary.shares_content && <div className="mt-1 text-sev-medium">The recordings share little audio content, so they may not be versions of the same recording.</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-5">
            {[
              ["Matched (suspect)", fmtPct(r.summary.matched_fraction_suspect)],
              ["Splice points", r.summary.splice_points],
              ["Added", r.summary.added_segments],
              ["Removed", r.summary.removed_segments],
              ["Duration Δ", `${r.summary.duration_difference_s >= 0 ? "+" : ""}${r.summary.duration_difference_s.toFixed(2)} s`],
            ].map(([k, v]) => (
              <div key={String(k)} className="bg-surface px-5 py-4">
                <div className="text-[12px] text-muted">{k}</div>
                <div className="tabular mt-1 text-xl font-semibold">{v}</div>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Alignment</CardTitle>
              <div className="flex flex-wrap gap-3 text-[11.5px] text-muted">
                {[["Matched", COLORS.matched], ["Added in suspect", COLORS.added], ["Changed / removed", COLORS.changed], ["Pause / silence", COLORS.pause]].map(([l, col]) => (
                  <span key={l} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: col }} />{l}</span>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              <AlignmentDiagram r={r} onPick={pick} picked={picked} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-[12px] text-muted">Alleged original</div>
                  {c.original_info?.has_audio ? <audio ref={audioA} controls src={api.audioUrl(c.original_id)} className="w-full" /> : <p className="text-sm text-muted">Audio deleted.</p>}
                </div>
                <div>
                  <div className="mb-1.5 text-[12px] text-muted">Suspect</div>
                  {c.suspect_info?.has_audio ? <audio ref={audioB} controls src={api.audioUrl(c.suspect_id)} className="w-full" /> : <p className="text-sm text-muted">Audio deleted.</p>}
                </div>
              </div>
              <p className="mt-2 text-[12px] text-faint">Click a segment in the diagram or the tables to cue both players to the corresponding position.</p>
            </CardBody>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Suspect timeline</CardTitle></CardHeader>
              <CardBody className="px-0 pb-2">
                <ul className="divide-y divide-line">
                  {r.timeline.map((s, i) => (
                    <li key={i}>
                      <button onClick={() => pick(s)} className={cn("flex w-full items-center gap-3 px-5 py-2.5 text-left text-[12.5px] hover:bg-elevated", picked === s && "bg-accent/10")}>
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.type === "matched" ? COLORS.matched : s.type === "changed" ? COLORS.changed : s.content === "pause_or_silence" ? COLORS.pause : COLORS.added }} />
                        <span className="tabular w-36 shrink-0 font-mono text-muted">{fmtTime(s.b_start)}–{fmtTime(s.b_end)}</span>
                        <span className="flex-1 text-ink-soft">
                          {s.type === "matched"
                            ? <>matches original {fmtTime(s.a_start)}–{fmtTime(s.a_end)} <span className="text-faint">· similarity {s.similarity?.toFixed(3)} · {s.level_difference_db! >= 0 ? "+" : ""}{s.level_difference_db?.toFixed(1)} dB{s.speed_ratio && Math.abs(s.speed_ratio - 1) > 0.002 ? ` · speed ×${s.speed_ratio.toFixed(4)}` : ""}</span></>
                            : s.type === "changed" ? <>replaces original {fmtTime(s.a_start)}–{fmtTime(s.a_end)}</>
                            : <>not in original ({s.content === "speech" ? "speech" : "pause or silence"})</>}
                        </span>
                        <Play className="size-3.5 text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Splice points in the suspect</CardTitle></CardHeader>
                <CardBody className="px-0 pb-2">
                  {r.splice_points.length === 0 ? <p className="px-5 pb-3 text-sm text-muted">No discontinuities in the mapping.</p> : (
                    <ul className="divide-y divide-line">
                      {r.splice_points.map((p, i) => (
                        <li key={i}>
                          <button className="flex w-full flex-wrap items-center gap-3 px-5 py-2.5 text-left text-[12.5px] hover:bg-elevated"
                            onClick={() => { cue(audioB.current, Math.max(0, p.b_time - 2)); cue(audioA.current, Math.max(0, p.a_from - 2)); }}>
                            <span className="tabular w-20 font-mono text-ink">{fmtTime(p.b_time)}</span>
                            <Badge>{KIND_TEXT[p.kind] ?? p.kind}</Badge>
                            <span className="text-muted">original jumps {fmtTime(p.a_from)} → {fmtTime(p.a_to)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>Original audio not found in the suspect</CardTitle></CardHeader>
                <CardBody className="px-0 pb-2">
                  {r.removed.length === 0 ? <p className="px-5 pb-3 text-sm text-muted">All of the original was found.</p> : (
                    <ul className="divide-y divide-line">
                      {r.removed.map((m, i) => (
                        <li key={i}>
                          <button className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-[12.5px] hover:bg-elevated" onClick={() => cue(audioA.current, m.a_start)}>
                            <span className="tabular w-36 font-mono text-muted">{fmtTime(m.a_start)}–{fmtTime(m.a_end)}</span>
                            <span className="text-ink-soft">{m.duration_s.toFixed(2)} s · {m.kind === "speech" ? "contains speech" : "pause or silence"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
                <CardBody>
                  <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-soft">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  <dl className="mt-4">
                    <KV k="Mean similarity" v={r.summary.mean_similarity?.toFixed(3) ?? "—"} />
                    <KV k="Median level difference" v={r.summary.median_level_difference_db != null ? `${r.summary.median_level_difference_db.toFixed(1)} dB` : "—"} />
                    <KV k="Method" v={<span className="text-[12px]">{r.method}</span>} />
                  </dl>
                </CardBody>
              </Card>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to top</Button>
          </div>
        </div>
      )}
    </div>
  );
}
