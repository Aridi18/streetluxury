import { useQuery } from "@tanstack/react-query";
import { FileAudio, Mic, MessageSquareText, Square, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ErrorBox, PageHeader } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRecorder } from "@/hooks/useRecorder";
import { uploadRecording } from "@/lib/api";
import { api } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const EXTENSIONS = ["wav", "mp3", "m4a", "mp4", "aac", "ogg", "oga", "opus", "flac", "webm", "weba", "amr", "aif", "aiff", "caf", "3gp"];
type Source = "upload" | "voice_note" | "microphone";

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function Dropzone({ onFile, maxMb, hint }: { onFile: (f: File) => void; maxMb: number; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        "flex w-full flex-col items-center justify-center rounded-[14px] border border-dashed px-6 py-14 text-center transition-colors",
        over ? "border-accent bg-accent/10" : "border-line-strong hover:border-accent/60 hover:bg-elevated",
      )}
    >
      <div className="rounded-xl bg-raised p-3 text-accent-soft">
        <FileAudio className="size-6" />
      </div>
      <div className="mt-4 text-[15px] font-medium">Drop an audio file here, or click to choose</div>
      <div className="mt-1.5 text-[13px] text-muted">{hint}</div>
      <div className="mt-1 text-[12px] text-faint">Up to {maxMb} MB</div>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={EXTENSIONS.map((e) => `.${e}`).join(",") + ",audio/*"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function LevelMeter({ level }: { level: number }) {
  const db = 20 * Math.log10(Math.max(level, 1e-5));
  const frac = Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
        <div className={cn("h-full transition-[width] duration-75", level > 0.98 ? "bg-sev-high" : "bg-accent-soft")} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="tabular w-16 text-right text-[12px] text-muted">{Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : "—"}</span>
    </div>
  );
}

export default function NewRecording() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, staleTime: 60_000 });
  const maxMb = sys.data?.limits.max_upload_mb ?? 100;
  const maxMin = sys.data?.limits.max_duration_minutes ?? 30;
  const [tab, setTab] = useState<string>(params.get("mode") === "record" ? "record" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<Source>("upload");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recorder = useRecorder(maxMin * 60);
  const previewUrl = useMemo(() => (recorder.blob ? URL.createObjectURL(recorder.blob) : null), [recorder.blob]);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  function pick(f: File, src: Source) {
    setError(null);
    const ext = extOf(f.name);
    if (!EXTENSIONS.includes(ext) && !f.type.startsWith("audio/")) {
      setError(`".${ext}" files are not supported. Supported: ${sys.data?.limits.formats ?? "common audio formats"}.`);
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setError(`This file is ${fmtBytes(f.size)}; the limit is ${maxMb} MB.`);
      return;
    }
    if (f.size === 0) {
      setError("The file is empty.");
      return;
    }
    setSource(src);
    setFile(f);
  }

  async function send(blob: Blob, filename: string, src: Source) {
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const rec = await uploadRecording(blob, { filename, source: src, title: title || undefined }, setProgress, abort.current.signal);
      toast.success("Recording uploaded", { description: "Preparing waveform and spectrogram…" });
      navigate(`/app/recordings/${rec.id}`);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  const selected = file && (
    <Card className="mt-5 p-5">
      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-raised p-2.5 text-accent-soft">
          <FileAudio className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{file.name}</div>
          <div className="text-[12.5px] text-muted">{fmtBytes(file.size)} · {file.type || "unknown type"}</div>
        </div>
        {!uploading && (
          <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="Remove file">
            <X />
          </Button>
        )}
      </div>
      <div className="mt-5">
        <Label htmlFor="title">Case label (optional)</Label>
        <Input id="title" maxLength={200} placeholder="e.g. Exhibit 4 — voicemail received 3 March" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      {uploading && <Progress value={progress ?? 0} className="mt-5" />}
      <div className="mt-5 flex justify-end gap-2">
        {uploading ? (
          <Button variant="secondary" onClick={() => abort.current?.abort()}>Cancel upload</Button>
        ) : (
          <Button onClick={() => send(file, file.name, source)}>
            <Upload /> Upload and open workspace
          </Button>
        )}
      </div>
    </Card>
  );

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader eyebrow="New analysis" title="Add a recording">
        Files are validated, hashed (SHA-256) and stored encrypted. Nothing is analysed until you start an analysis.
      </PageHeader>
      {error && <ErrorBox className="mb-5">{error}</ErrorBox>}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setFile(null); setError(null); }}>
        <TabsList>
          <TabsTrigger value="upload"><Upload className="mr-1.5 inline size-4" />Upload file</TabsTrigger>
          <TabsTrigger value="voice"><MessageSquareText className="mr-1.5 inline size-4" />Voice note</TabsTrigger>
          <TabsTrigger value="record"><Mic className="mr-1.5 inline size-4" />Record</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          {!file && <Dropzone onFile={(f) => pick(f, "upload")} maxMb={maxMb} hint="WAV, MP3, M4A/AAC, OGG/Opus, FLAC, WebM, AMR, AIFF, CAF" />}
          {selected}
        </TabsContent>
        <TabsContent value="voice">
          {!file && (
            <>
              <Dropzone onFile={(f) => pick(f, "voice_note")} maxMb={maxMb} hint="Voice notes exported from WhatsApp, Telegram, Signal or iMessage (.opus, .ogg, .m4a, .aac)" />
              <p className="mt-4 text-[13px] leading-relaxed text-muted">
                Messaging apps re-encode audio and remove most metadata. Analysis is still possible, but some evidence
                (bandwidth, fine waveform detail, original timestamps) is lost. If you can obtain the original recording
                from the sender's device, analyse that instead.
              </p>
            </>
          )}
          {selected}
        </TabsContent>
        <TabsContent value="record">
          <Card className="p-6">
            {recorder.error && <ErrorBox className="mb-4">{recorder.error}</ErrorBox>}
            {recorder.state !== "stopped" ? (
              <div className="flex flex-col items-center py-6 text-center">
                <button
                  onClick={recorder.state === "recording" ? recorder.stop : recorder.start}
                  disabled={recorder.state === "requesting"}
                  className={cn(
                    "grid size-20 place-items-center rounded-full border transition-colors",
                    recorder.state === "recording" ? "border-sev-high/50 bg-sev-high-bg text-sev-high" : "border-accent/50 bg-accent/15 text-accent-soft hover:bg-accent/25",
                  )}
                  aria-label={recorder.state === "recording" ? "Stop recording" : "Start recording"}
                >
                  {recorder.state === "recording" ? <Square className="size-7" /> : <Mic className="size-8" />}
                </button>
                <div className="tabular mt-5 text-3xl font-semibold">{fmtTime(recorder.elapsed, false)}</div>
                <div className="mt-1 text-[13px] text-muted">
                  {recorder.state === "recording" ? "Recording…" : recorder.state === "requesting" ? "Waiting for microphone permission…" : `Up to ${maxMin} minutes`}
                </div>
                {recorder.state === "recording" && (
                  <div className="mt-6 w-full max-w-sm">
                    <LevelMeter level={recorder.level} />
                  </div>
                )}
                <p className="mt-6 max-w-md text-[12.5px] leading-relaxed text-faint">
                  Browser noise suppression, echo cancellation and automatic gain are switched off so the recording is
                  not altered. Audio stays in this browser until you upload it.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-[13px] text-muted">
                  Recorded {fmtTime(recorder.elapsed, false)} · {fmtBytes(recorder.blob?.size)} · {recorder.blob?.type}
                  {recorder.settings?.sampleRate ? ` · ${recorder.settings.sampleRate} Hz` : ""}
                </div>
                {previewUrl && <audio controls src={previewUrl} className="mt-4 w-full" />}
                <div className="mt-5">
                  <Label htmlFor="rtitle">Case label (optional)</Label>
                  <Input id="rtitle" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                {uploading && <Progress value={progress ?? 0} className="mt-5" />}
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" onClick={recorder.reset} disabled={uploading}>Discard</Button>
                  <Button
                    disabled={uploading || !recorder.blob}
                    onClick={() => {
                      const b = recorder.blob!;
                      const ext = b.type.includes("mp4") ? "m4a" : b.type.includes("ogg") ? "ogg" : "webm";
                      send(b, `microphone-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, "microphone");
                    }}
                  >
                    <Upload /> Upload recording
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
