import {
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  ScanLine,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.esm.js";
import MinimapPlugin from "wavesurfer.js/dist/plugins/minimap.esm.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { fmtHz, fmtTime } from "@/lib/format";
import type { Finding, SpectrogramTile, SyntheticWindow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SEVERITY_STYLE } from "@/lib/verdict";

const WAVE_H = 120;
const TIMELINE_H = 22;
const SPEC_H = 132;
const ML_H = 26;
const SELECTION_ID = "__selection__";

export interface TimelineHandle {
  seek: (t: number) => void;
  playRange: (start: number, end: number) => void;
  focus: (start: number, end: number) => void;
}

interface Props {
  audioUrl: string;
  peaks: number[];
  duration: number;
  tiles: SpectrogramTile[];
  tileUrl: (index: number) => string;
  maxFreqHz: number;
  findings: Finding[];
  activeFindingId: string | null;
  onFindingClick: (id: string) => void;
  syntheticWindows?: SyntheticWindow[] | null;
  syntheticKey?: "p_calibrated" | "p_model";
  syntheticThresholds?: { possible: number; strong: number } | null;
  selection: { start: number; end: number } | null;
  onSelection: (sel: { start: number; end: number } | null) => void;
  onTime?: (t: number) => void;
}

function regionColor(f: Finding) {
  return f.category === "synthetic" ? SEVERITY_STYLE.synthetic.region : SEVERITY_STYLE[f.severity].region;
}

function probColor(p: number, thr?: { possible: number; strong: number } | null) {
  if (thr) {
    if (p >= thr.strong) return "rgba(251,113,133,0.85)";
    if (p >= thr.possible) return "rgba(192,132,252,0.8)";
  }
  const a = 0.12 + 0.6 * p;
  return `rgba(167,139,250,${a.toFixed(2)})`;
}

export const ForensicTimeline = forwardRef<TimelineHandle, Props>(function ForensicTimeline(props, ref) {
  const {
    audioUrl, peaks, duration, tiles, tileUrl, maxFreqHz, findings, activeFindingId, onFindingClick,
    syntheticWindows, syntheticKey = "p_model", syntheticThresholds, selection, onSelection, onTime,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const specLane = useRef<HTMLDivElement | null>(null);
  const mlLane = useRef<HTMLDivElement | null>(null);
  const loopRef = useRef(false);
  const rangeEnd = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [minZoom, setMinZoom] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const cb = useRef({ onFindingClick, onSelection, onTime });
  cb.current = { onFindingClick, onSelection, onTime };
  loopRef.current = loop;

  // Create the player once per recording.
  useEffect(() => {
    if (!container.current) return;
    const regionsPlugin = RegionsPlugin.create();
    const w = WaveSurfer.create({
      container: container.current,
      height: WAVE_H,
      waveColor: "#5f4f96",
      progressColor: "#c4b5fd",
      cursorColor: "#f4f3f8",
      cursorWidth: 1.5,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      url: audioUrl,
      peaks: [peaks],
      duration,
      dragToSeek: true,
      autoScroll: true,
      autoCenter: false,
      hideScrollbar: false,
      fetchParams: { credentials: "same-origin" },
      plugins: [
        regionsPlugin,
        TimelinePlugin.create({
          height: TIMELINE_H,
          style: { color: "#9592a8", fontSize: "10.5px" },
          formatTimeCallback: (s: number) => fmtTime(s, false),
        }),
        HoverPlugin.create({ lineColor: "#a78bfa", lineWidth: 1, labelBackground: "#1e1e28", labelColor: "#f4f3f8", labelSize: "11px" }),
        MinimapPlugin.create({
          container: minimapRef.current ?? undefined,
          height: 28,
          waveColor: "#3d3560",
          progressColor: "#7c6ab0",
          overlayColor: "rgba(167,139,250,0.14)",
          cursorWidth: 0,
          barWidth: 1,
          barGap: 1,
        }),
      ],
    });
    ws.current = w;
    regions.current = regionsPlugin;

    const wrapper = w.getWrapper();
    // Spectrogram lane (tiles scale with zoom because they are positioned in % of the wrapper).
    const spec = document.createElement("div");
    Object.assign(spec.style, { position: "relative", height: `${SPEC_H}px`, width: "100%", background: "#0b0a10", marginTop: "2px" });
    tiles.forEach((t) => {
      const img = document.createElement("img");
      img.src = tileUrl(t.index);
      img.alt = "";
      img.draggable = false;
      Object.assign(img.style, {
        position: "absolute",
        top: "0",
        height: "100%",
        left: `${(t.start / duration) * 100}%`,
        width: `${((t.end - t.start) / duration) * 100}%`,
        pointerEvents: "none",
        userSelect: "none",
      });
      spec.appendChild(img);
    });
    wrapper.appendChild(spec);
    specLane.current = spec;
    const ml = document.createElement("div");
    Object.assign(ml.style, { position: "relative", height: `${ML_H}px`, width: "100%", background: "#0e0d14", marginTop: "2px" });
    wrapper.appendChild(ml);
    mlLane.current = ml;

    const fit = () => {
      const width = container.current?.clientWidth ?? 800;
      const z = Math.max(1, width / Math.max(duration, 0.1));
      setMinZoom(z);
      return z;
    };
    w.on("ready", () => {
      const z = fit();
      setZoom(z);
      w.zoom(z);
      setReady(true);
    });
    w.on("play", () => setPlaying(true));
    w.on("pause", () => setPlaying(false));
    w.on("finish", () => setPlaying(false));
    w.on("timeupdate", (t) => {
      setTime(t);
      cb.current.onTime?.(t);
      const end = rangeEnd.current;
      if (end != null && t >= end) {
        const sel = regionsPlugin.getRegions().find((r) => r.id === SELECTION_ID);
        if (loopRef.current && sel) {
          w.setTime(sel.start);
        } else {
          w.pause();
          rangeEnd.current = null;
        }
      }
    });
    w.on("interaction", () => {
      rangeEnd.current = null;
    });

    regionsPlugin.enableDragSelection({ color: "rgba(167,139,250,0.16)" }, 4);
    regionsPlugin.on("region-created", (r: Region) => {
      if (r.id.startsWith("f-")) return;
      regionsPlugin.getRegions().forEach((o) => o !== r && o.id === SELECTION_ID && o.remove());
      if (r.id !== SELECTION_ID) {
        const { start, end } = r;
        r.remove();
        regionsPlugin.addRegion({ id: SELECTION_ID, start, end, color: "rgba(167,139,250,0.16)", drag: true, resize: true });
        cb.current.onSelection({ start, end });
      }
    });
    regionsPlugin.on("region-updated", (r: Region) => {
      if (r.id === SELECTION_ID) cb.current.onSelection({ start: r.start, end: r.end });
    });
    regionsPlugin.on("region-clicked", (r: Region, e: MouseEvent) => {
      if (r.id.startsWith("f-")) {
        e.stopPropagation();
        cb.current.onFindingClick(r.id.slice(2));
        w.setTime(r.start);
      }
    });

    const onResize = () => {
      const z = fit();
      setZoom((cur) => Math.max(cur, z));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      w.destroy();
      ws.current = null;
      regions.current = null;
      setReady(false);
    };
  }, [audioUrl, duration]);

  // Finding regions.
  useEffect(() => {
    const r = regions.current;
    if (!r || !ready) return;
    r.getRegions().filter((x) => x.id.startsWith("f-")).forEach((x) => x.remove());
    findings.forEach((f) => {
      const minLen = Math.max(0.04, duration / 2000);
      const start = Math.max(0, f.start);
      const end = Math.min(duration, Math.max(f.end, start + minLen));
      const active = f.id === activeFindingId;
      const content = document.createElement("div");
      content.textContent = f.id;
      Object.assign(content.style, {
        fontSize: "10px",
        fontWeight: "600",
        color: f.category === "synthetic" ? "#e9d5ff" : f.severity === "high" ? "#fecdd3" : "#fde68a",
        padding: "2px 4px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      });
      const reg = r.addRegion({ id: `f-${f.id}`, start, end, color: regionColor(f), drag: false, resize: false, content });
      if (reg.element) {
        reg.element.style.borderLeft = `1px solid ${active ? "#f4f3f8" : "rgba(255,255,255,0.25)"}`;
        reg.element.style.borderRight = `1px solid ${active ? "#f4f3f8" : "rgba(255,255,255,0.25)"}`;
        reg.element.style.boxShadow = active ? "inset 0 0 0 1px rgba(244,243,248,0.7)" : "none";
        reg.element.style.cursor = "pointer";
        reg.element.setAttribute("title", `${f.id} · ${f.label} · ${fmtTime(f.start)}–${fmtTime(f.end)}`);
      }
    });
  }, [findings, activeFindingId, ready, duration]);

  // Synthetic-probability lane.
  useEffect(() => {
    const lane = mlLane.current;
    if (!lane || !ready) return;
    lane.innerHTML = "";
    (syntheticWindows ?? []).forEach((w) => {
      const p = w[syntheticKey];
      if (!w.scored || p == null) return;
      const mid0 = w.start + (w.end - w.start) * 0.25;
      const mid1 = w.end - (w.end - w.start) * 0.25;
      const d = document.createElement("div");
      Object.assign(d.style, {
        position: "absolute",
        top: "3px",
        bottom: "3px",
        left: `${(mid0 / duration) * 100}%`,
        width: `${((mid1 - mid0) / duration) * 100}%`,
        background: probColor(p, syntheticKey === "p_calibrated" ? syntheticThresholds : null),
        borderRadius: "2px",
      });
      d.title = `${fmtTime(w.start)}–${fmtTime(w.end)} · p = ${p.toFixed(3)}`;
      lane.appendChild(d);
    });
  }, [syntheticWindows, syntheticKey, syntheticThresholds, ready, duration]);

  // External selection changes (e.g. cleared by the parent).
  useEffect(() => {
    const r = regions.current;
    if (!r || !ready) return;
    const existing = r.getRegions().find((x) => x.id === SELECTION_ID);
    if (!selection && existing) existing.remove();
  }, [selection, ready]);

  useEffect(() => {
    ws.current?.setPlaybackRate(rate, true);
  }, [rate]);

  const applyZoom = useCallback((z: number) => {
    const clamped = Math.max(minZoom, Math.min(2000, z));
    setZoom(clamped);
    ws.current?.zoom(clamped);
  }, [minZoom]);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => ws.current?.setTime(t),
    playRange: (start: number, end: number) => {
      const w = ws.current;
      if (!w) return;
      rangeEnd.current = end;
      w.setTime(start);
      void w.play();
    },
    focus: (start: number, end: number) => {
      const w = ws.current;
      if (!w || !container.current) return;
      const width = container.current.clientWidth;
      const span = Math.max(1.5, (end - start) * 3);
      const z = Math.max(minZoom, Math.min(2000, width / span));
      applyZoom(z);
      requestAnimationFrame(() => w.setScrollTime(Math.max(0, (start + end) / 2 - span / 2)));
      w.setTime(start);
    },
  }), [applyZoom, minZoom]);

  const togglePlay = () => {
    const w = ws.current;
    if (!w) return;
    if (w.isPlaying()) {
      w.pause();
      return;
    }
    if (selection && loop) {
      rangeEnd.current = selection.end;
      w.setTime(selection.start);
    }
    void w.play();
  };

  // Keyboard shortcuts while the timeline has focus.
  const onKey = (e: React.KeyboardEvent) => {
    const w = ws.current;
    if (!w) return;
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      w.setTime(Math.max(0, w.getCurrentTime() - (e.shiftKey ? 1 : 5)));
    } else if (e.key === "ArrowRight") {
      w.setTime(Math.min(duration, w.getCurrentTime() + (e.shiftKey ? 1 : 5)));
    } else if (e.key === "+" || e.key === "=") {
      applyZoom(zoom * 1.6);
    } else if (e.key === "-") {
      applyZoom(zoom / 1.6);
    }
  };

  const zoomFrac = Math.log(zoom / minZoom) / Math.log(Math.max(2000 / minZoom, 1.0001));

  return (
    <div className="card overflow-hidden" tabIndex={0} onKeyDown={onKey} aria-label="Forensic timeline. Space to play or pause, arrow keys to seek, plus and minus to zoom.">
      <div ref={minimapRef} className="border-b border-line bg-elevated px-3 pt-2" aria-hidden />
      <div className="flex">
        <div className="hidden w-[92px] shrink-0 flex-col border-r border-line bg-surface text-[10.5px] leading-tight text-faint sm:flex">
          <div style={{ height: WAVE_H }} className="flex items-center px-3">Waveform</div>
          <div style={{ height: TIMELINE_H }} />
          <div style={{ height: SPEC_H + 2 }} className="flex flex-col justify-between px-3 py-1">
            <span>{fmtHz(maxFreqHz)}</span>
            <span>Spectrogram</span>
            <span>0 Hz</span>
          </div>
          <div style={{ height: ML_H + 2 }} className="flex items-center px-3">
            <Tooltip content={syntheticKey === "p_calibrated" ? "Calibrated synthetic-speech probability per window" : "Uncalibrated model output per window (reference only)"}>
              <span className="cursor-help underline decoration-dotted">Synthetic p</span>
            </Tooltip>
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          {!ready && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-surface/80 text-sm text-muted">
              <Spinner /> Loading audio…
            </div>
          )}
          <div ref={container} className="w-full" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-elevated px-3 py-2.5">
        <Button size="icon" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => ws.current?.setTime(Math.max(0, time - 5))} aria-label="Back 5 seconds" disabled={!ready}>
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => ws.current?.setTime(Math.min(duration, time + 5))} aria-label="Forward 5 seconds" disabled={!ready}>
          <RotateCw />
        </Button>
        <div className="tabular min-w-[150px] px-2 font-mono text-[12.5px] text-ink-soft">
          {fmtTime(time)} <span className="text-faint">/ {fmtTime(duration)}</span>
        </div>
        <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <Tooltip content="Loop the selected range">
          <Button
            variant={loop ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setLoop((v) => !v)}
            aria-pressed={loop}
            aria-label="Loop selection"
            className={cn(loop && "text-accent-soft")}
          >
            <Repeat />
          </Button>
        </Tooltip>
        {selection && (
          <Button variant="ghost" size="sm" onClick={() => {
            rangeEnd.current = selection.end;
            ws.current?.setTime(selection.start);
            void ws.current?.play();
          }}>
            <ScanLine /> Play selection
          </Button>
        )}
        <select
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="h-8 rounded-md border border-line-strong bg-raised px-2 text-[12.5px] text-ink-soft"
          aria-label="Playback speed"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((r) => (
            <option key={r} value={r}>{r}×</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" onClick={() => applyZoom(zoom / 1.6)} aria-label="Zoom out" disabled={!ready}>
            <Minus />
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={Number.isFinite(zoomFrac) ? zoomFrac : 0}
            onChange={(e) => applyZoom(minZoom * Math.pow(2000 / minZoom, Number(e.target.value)))}
            className="w-28 accent-[#8b5cf6]"
            aria-label="Zoom"
          />
          <Button variant="ghost" size="icon-sm" onClick={() => applyZoom(zoom * 1.6)} aria-label="Zoom in" disabled={!ready}>
            <Plus />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => applyZoom(minZoom)} disabled={!ready}>Fit</Button>
        </div>
      </div>
    </div>
  );
});
