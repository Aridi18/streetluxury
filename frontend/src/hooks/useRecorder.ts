import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "error";

function pickMime(): string | undefined {
  const options = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return options.find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Microphone capture with browser speech processing disabled (noise suppression,
 * echo cancellation and automatic gain would alter the evidence).
 */
export function useRecorder(maxSeconds = 1800) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const started = useRef(0);
  const chunks = useRef<BlobPart[]>([]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setElapsed(0);
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Microphone recording is not available in this browser or on an insecure (non-HTTPS) connection.");
      return;
    }
    setState("requesting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      stream.current = s;
      setSettings(s.getAudioTracks()[0]?.getSettings() ?? null);
      const audioCtx = new AudioContext();
      ctx.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(s).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        setLevel(peak);
        const t = (performance.now() - started.current) / 1000;
        setElapsed(t);
        if (t >= maxSeconds) stop();
        raf.current = requestAnimationFrame(tick);
      };
      const mime = pickMime();
      const mr = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        setBlob(new Blob(chunks.current, { type: mr.mimeType || mime || "audio/webm" }));
        setState("stopped");
        cleanup();
      };
      rec.current = mr;
      started.current = performance.now();
      mr.start(1000);
      raf.current = requestAnimationFrame(tick);
      setState("recording");
    } catch (e) {
      cleanup();
      setState("error");
      const name = (e as DOMException).name;
      setError(
        name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser settings to record."
          : name === "NotFoundError"
            ? "No microphone was found."
            : `Could not start recording (${(e as Error).message}).`,
      );
    }
  }, [cleanup, maxSeconds, stop]);

  const reset = useCallback(() => {
    setBlob(null);
    setElapsed(0);
    setState("idle");
  }, []);

  return { state, error, elapsed, level, blob, settings, start, stop, reset };
}
