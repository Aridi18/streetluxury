import { ChevronRight, Copy, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { ScoreBar, SeverityBadge } from "@/components/Badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtTime } from "@/lib/format";
import type { Finding, Observation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FAMILY_LABEL } from "@/lib/verdict";

const DETECTOR_LABEL: Record<string, string> = {
  bandwidth: "Bandwidth consistency",
  noise_floor: "Background noise continuity",
  noise_track: "Noise floor through speech",
  spectral_change: "Acoustic change (ΔBIC)",
  discontinuity: "Waveform discontinuities",
  digital_silence: "Digital silence",
  level: "Speech level steps",
  pitch: "Pitch continuity",
  reverb: "Room acoustics",
  duplication: "Duplicated segments",
  enf: "Mains hum (ENF)",
};

export function detectorLabel(id: string) {
  return DETECTOR_LABEL[id] ?? id;
}

export function FindingsList({
  findings,
  activeId,
  onSelect,
  onPlay,
  playheadTime,
}: {
  findings: Finding[];
  activeId: string | null;
  onSelect: (f: Finding) => void;
  onPlay: (f: Finding) => void;
  playheadTime: number;
}) {
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (activeId) refs.current[activeId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);
  return (
    <ul className="divide-y divide-line">
      {findings.map((f) => {
        const active = f.id === activeId;
        const under = playheadTime >= f.start - 0.05 && playheadTime <= f.end + 0.05;
        return (
          <li key={f.id} ref={(el) => void (refs.current[f.id] = el)}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(f)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(f))}
              className={cn(
                "group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors",
                active ? "bg-accent/10" : "hover:bg-elevated",
              )}
            >
              <div className={cn("mt-1 h-8 w-1 shrink-0 rounded-full", f.category === "synthetic" ? "bg-synthetic" : f.severity === "high" ? "bg-sev-high" : "bg-sev-medium", under && "animate-pulse-soft")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-faint">{f.id}</span>
                  <span className="text-[13.5px] font-medium">{f.label}</span>
                  <SeverityBadge severity={f.severity} synthetic={f.category === "synthetic"} />
                </div>
                <div className="tabular mt-0.5 font-mono text-[12px] text-muted">
                  {fmtTime(f.start)} – {fmtTime(f.end)}
                  {f.related && <span className="text-faint"> · matches {fmtTime(f.related.source_start)}</span>}
                </div>
                <div className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">{f.summary}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {Object.keys(f.families).map((fam) => (
                    <Badge key={fam} className="text-[10.5px]">{FAMILY_LABEL[fam] ?? fam}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <ScoreBar value={f.score} tone={f.category === "synthetic" ? "synthetic" : f.severity === "high" ? "high" : "medium"} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(f);
                  }}
                  aria-label={`Play ${f.id}`}
                >
                  <Play /> Play
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ObservationsList({ items, onSelect }: { items: Observation[]; onSelect: (o: Observation) => void }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((o) => (
        <li key={o.id}>
          <button onClick={() => onSelect(o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elevated">
            <span className="font-mono text-[11px] text-faint">{o.id}</span>
            <span className="tabular font-mono text-[12px] text-muted">{fmtTime(o.start)}</span>
            <span className="flex-1 truncate text-[12.5px] text-ink-soft">{Object.keys(o.families).map((f) => FAMILY_LABEL[f] ?? f).join(", ")}</span>
            <span className="tabular text-[11.5px] text-faint">{o.score.toFixed(2)}</span>
            <ChevronRight className="size-3.5 text-faint" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function measurementRows(m: Record<string, unknown>) {
  return Object.entries(m)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 8)
    .map(([k, v]) => [k.replace(/_/g, " "), typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : String(v)] as const);
}

export function FindingDetail({ f, onPlay, onFocus }: { f: Finding; onPlay: () => void; onFocus: () => void }) {
  return (
    <div className="animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-faint">{f.id}</span>
        <h3 className="text-[16px] font-semibold">{f.label}</h3>
        <SeverityBadge severity={f.severity} synthetic={f.category === "synthetic"} />
      </div>
      <div className="tabular mt-1 font-mono text-[12.5px] text-muted">
        {fmtTime(f.start)} – {fmtTime(f.end)} · score {f.score.toFixed(2)} · {f.basis}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onPlay}><Play /> Play segment</Button>
        <Button size="sm" variant="secondary" onClick={onFocus}>Zoom to segment</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigator.clipboard?.writeText(`${f.id} ${f.label} ${fmtTime(f.start)}–${fmtTime(f.end)}`)}
        >
          <Copy /> Copy reference
        </Button>
      </div>
      <p className="mt-4 rounded-lg border border-line bg-elevated px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
        {f.category === "synthetic"
          ? "Inferred by a machine-learning model. Model scores indicate similarity to known synthetic speech; they are not proof that this audio was generated."
          : "Inferred from signal analysis. This interval shows a trace that editing can leave; it is not a confirmed manipulation."}
      </p>
      {f.related && (
        <div className="mt-4 rounded-lg border border-line px-3.5 py-2.5 text-[13px]">
          Identical audio also occurs at <span className="font-mono">{fmtTime(f.related.source_start)} – {fmtTime(f.related.source_end)}</span>.
          Either occurrence may be the copy; both are marked on the timeline.
        </div>
      )}
      <h4 className="eyebrow mt-6">Supporting evidence</h4>
      <div className="mt-3 space-y-3">
        {f.evidence.map((e, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-medium">{e.family === "synthetic" ? e.detector : detectorLabel(e.detector)}</div>
              <ScoreBar value={e.strength} tone={e.family === "synthetic" ? "synthetic" : e.strength >= 0.75 ? "high" : "medium"} />
            </div>
            <div className="mt-0.5 text-[11.5px] text-faint">{FAMILY_LABEL[e.family] ?? e.family} · {fmtTime(e.start)}–{fmtTime(e.end)}</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{e.explanation}</p>
            {measurementRows(e.measurements).length > 0 && (
              <dl className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-1 border-t border-line pt-2.5 sm:grid-cols-2">
                {measurementRows(e.measurements).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-[11.5px]">
                    <dt className="text-faint">{k}</dt>
                    <dd className="tabular font-mono text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
      {f.alternatives.length > 0 && (
        <>
          <h4 className="eyebrow mt-6">Other possible explanations</h4>
          <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
            {f.alternatives.map((a) => (
              <li key={a} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
