import { fmtTime } from "@/lib/format";
import type { SyntheticWindow } from "@/lib/types";

/** Bar chart of per-window synthetic-speech probability over time. */
export function WindowChart({
  windows,
  duration,
  pKey,
  thresholds,
  height = 120,
}: {
  windows: SyntheticWindow[];
  duration: number;
  pKey: "p_calibrated" | "p_model";
  thresholds?: { possible: number; strong: number } | null;
  height?: number;
}) {
  const W = 1000;
  const H = height;
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (t: number) => pad.l + (t / Math.max(duration, 0.001)) * iw;
  const y = (p: number) => pad.t + (1 - p) * ih;
  const scored = windows.filter((w) => w.scored && w[pKey] != null);
  const ticks = 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Synthetic-speech probability per window">
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} stroke="#272733" strokeWidth={1} />
          <text x={pad.l - 6} y={y(p) + 3.5} textAnchor="end" fontSize={10} fill="#6c697f">{p.toFixed(1)}</text>
        </g>
      ))}
      {windows.filter((w) => !w.scored).map((w, i) => (
        <rect key={`u${i}`} x={x(w.start + (w.end - w.start) * 0.25)} y={pad.t} width={Math.max(1, x(w.end) - x(w.start)) * 0.5} height={ih} fill="#17171f" />
      ))}
      {scored.map((w, i) => {
        const p = w[pKey] as number;
        const x0 = x(w.start + (w.end - w.start) * 0.25);
        const bw = Math.max(1.5, (x(w.end) - x(w.start)) * 0.5 - 1);
        const colour = thresholds && pKey === "p_calibrated"
          ? p >= thresholds.strong ? "#fb7185" : p >= thresholds.possible ? "#c084fc" : "#6d5ba8"
          : "#8b7bc4";
        return (
          <rect key={i} x={x0} y={y(p)} width={bw} height={Math.max(1, ih - (y(p) - pad.t))} fill={colour} rx={1}>
            <title>{`${fmtTime(w.start)}–${fmtTime(w.end)}: p = ${p.toFixed(3)}`}</title>
          </rect>
        );
      })}
      {thresholds && pKey === "p_calibrated" && (
        <>
          <line x1={pad.l} x2={W - pad.r} y1={y(thresholds.possible)} y2={y(thresholds.possible)} stroke="#c084fc" strokeDasharray="4 4" strokeWidth={1} />
          <line x1={pad.l} x2={W - pad.r} y1={y(thresholds.strong)} y2={y(thresholds.strong)} stroke="#fb7185" strokeDasharray="4 4" strokeWidth={1} />
          <text x={W - pad.r} y={y(thresholds.possible) - 3} textAnchor="end" fontSize={9.5} fill="#c084fc">possible</text>
          <text x={W - pad.r} y={y(thresholds.strong) - 3} textAnchor="end" fontSize={9.5} fill="#fb7185">strong</text>
        </>
      )}
      {Array.from({ length: ticks + 1 }, (_, i) => (i / ticks) * duration).map((t) => (
        <text key={t} x={x(t)} y={H - 5} textAnchor="middle" fontSize={10} fill="#6c697f">{fmtTime(t, false)}</text>
      ))}
    </svg>
  );
}
