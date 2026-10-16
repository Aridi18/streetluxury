import {
  ArrowRight,
  AudioWaveform,
  Bot,
  FileText,
  GitCompareArrows,
  Lock,
  ScanSearch,
  Scissors,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// Deterministic, decorative bar heights for the schematic preview (not data).
const BARS = Array.from({ length: 120 }, (_, i) => {
  const s = Math.sin(i * 0.37) * 0.5 + Math.sin(i * 1.13) * 0.3 + Math.sin(i * 0.071) * 0.2;
  const gate = (i > 18 && i < 34) || (i > 52 && i < 61) || i > 98 ? 0.18 : 1;
  return Math.max(0.06, Math.abs(s) * gate);
});

function Preview() {
  return (
    <div className="card relative overflow-hidden p-4 sm:p-5" aria-label="Schematic illustration of the analysis workspace">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span className="size-2 rounded-full bg-accent-soft" /> Analysis workspace
        </div>
        <span className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-faint">Illustration — not a real analysis</span>
      </div>
      <div className="relative h-24 rounded-lg bg-elevated px-2">
        <div className="absolute inset-y-0 left-[46%] w-[6%] rounded bg-sev-medium/15 ring-1 ring-sev-medium/40" />
        <div className="absolute inset-y-0 left-[78%] w-[10%] rounded bg-synthetic/15 ring-1 ring-synthetic/40" />
        <div className="relative flex h-full items-center gap-[2px]">
          {BARS.map((h, i) => (
            <div key={i} className={cn("flex-1 rounded-full", i < 46 ? "bg-accent-soft" : "bg-accent/45")} style={{ height: `${h * 88}%` }} />
          ))}
        </div>
      </div>
      <div className="mt-2 h-10 rounded-lg bg-[linear-gradient(180deg,#2b1650_0%,#160d29_60%,#0d0b14_100%)] opacity-90" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-elevated p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-ink">Possible edit</span>
            <span className="rounded bg-sev-medium-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sev-medium">Medium</span>
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-muted">Background noise and bandwidth change at the same instant.</div>
        </div>
        <div className="rounded-lg border border-line bg-elevated p-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-ink">Possible synthetic speech</span>
            <span className="rounded bg-synthetic-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-synthetic">Model</span>
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-muted">Windows above a calibrated threshold, with the model named.</div>
        </div>
      </div>
    </div>
  );
}

const CAPABILITIES = [
  { icon: Scissors, title: "Edit & splice detection", body: "Background-noise continuity, bandwidth shifts, waveform clicks, digital silence, room-acoustic changes, mains-hum (ENF) phase and duplicated audio." },
  { icon: Bot, title: "Synthetic speech detection", body: "Documented pretrained detectors scored over overlapping windows, with calibrated thresholds and the model, licence and training data shown for every score." },
  { icon: AudioWaveform, title: "Interactive forensic timeline", body: "Waveform, full-band spectrogram and flagged regions on one zoomable timeline. Click any finding to hear it." },
  { icon: GitCompareArrows, title: "Original vs. edited", body: "Align an alleged original with a suspect copy to see added, removed, re-ordered and changed segments — confirmed by direct comparison." },
  { icon: FileText, title: "Forensic reports", body: "PDF reports with file hashes, evidence, detector versions, calibration provenance, limitations and a chain-of-custody log." },
  { icon: Lock, title: "Private by design", body: "Encrypted private storage, no public file links, configurable retention, user-controlled deletion and no training on your recordings." },
];

const CATEGORIES = [
  { k: "No significant manipulation indicators detected", d: "The applicable checks found nothing above their validated thresholds. This is not proof of authenticity.", c: "text-ok" },
  { k: "Possible manipulation detected", d: "At least one finding above the reporting threshold. Review the flagged intervals.", c: "text-sev-medium" },
  { k: "Strong indicators of synthetic or manipulated audio", d: "High-severity evidence, e.g. independent signals agreeing or a sustained calibrated model score.", c: "text-sev-high" },
  { k: "Inconclusive — more evidence required", d: "Quality, coverage or calibration does not support a conclusion either way.", c: "text-ink-soft" },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-full bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <a href="#method" className="hidden px-3 text-sm text-muted hover:text-ink sm:block">Method</a>
          <a href="#privacy" className="hidden px-3 text-sm text-muted hover:text-ink sm:block">Privacy</a>
          {user ? (
            <Link to="/app" className={buttonVariants({ size: "sm" })}>Open dashboard</Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Sign in</Link>
              <Link to="/register" className={buttonVariants({ size: "sm" })}>Create account</Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div className="animate-fade-in">
          <div className="eyebrow mb-4 flex items-center gap-2"><ScanSearch className="size-3.5 text-accent-soft" /> Digital audio forensics</div>
          <h1 className="text-[34px] font-semibold leading-[1.12] tracking-tight sm:text-[44px]">
            Evidence-based analysis for recordings you need to trust.
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink-soft">
            Audio Sentinel examines uploaded or recorded audio for signs of editing, splicing and AI-generated speech,
            and shows exactly where it found them, which check found them, and how much weight they carry.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? "/app/new" : "/register"} className={buttonVariants({ size: "lg" })}>
              Analyse a recording <ArrowRight />
            </Link>
            <a href="#method" className={buttonVariants({ variant: "secondary", size: "lg" })}>How it works</a>
          </div>
          <p className="mt-6 text-[12.5px] text-faint">WAV · MP3 · M4A/AAC · OGG/Opus · FLAC · WebM · browser microphone · messaging-app voice notes</p>
        </div>
        <Preview />
      </section>

      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden px-5 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="p-5">
              <c.icon className="size-5 text-accent-soft" aria-hidden />
              <h3 className="mt-4 text-[15px] font-semibold">{c.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="method" className="mx-auto max-w-6xl px-5 py-20">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <div className="eyebrow mb-3">Method</div>
            <h2 className="text-2xl font-semibold tracking-tight">Two independent kinds of evidence, never blended into a black box.</h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
              Signal-processing checks look for the physical traces editing leaves behind. Machine-learning models look for
              the artefacts speech generators leave behind. They are reported separately, every result names the check or
              model that produced it, and only detectors calibrated on held-out data may influence the verdict.
            </p>
            <ul className="mt-6 space-y-3 text-[13.5px] text-ink-soft">
              <li className="flex gap-3"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-soft" /> The recording is divided into overlapping windows; each instant is compared with the audio on both sides.</li>
              <li className="flex gap-3"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-soft" /> Evidence from different families is combined so that agreement counts, and isolated weak signals do not.</li>
              <li className="flex gap-3"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-soft" /> Pauses, silence and normal speech variation are not treated as tampering.</li>
              <li className="flex gap-3"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-soft" /> If a model is not installed, the report says “Detection model not configured” — it never guesses.</li>
            </ul>
          </div>
          <div className="card p-6">
            <div className="eyebrow mb-4">Result categories</div>
            <div className="space-y-4">
              {CATEGORIES.map((c) => (
                <div key={c.k} className="border-b border-line pb-4 last:border-0 last:pb-0">
                  <div className={cn("text-[14px] font-semibold", c.c)}>{c.k}</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-muted">{c.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="privacy" className="border-t border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1fr_1.4fr]">
          <div>
            <ShieldCheck className="size-6 text-accent-soft" aria-hidden />
            <h2 className="mt-4 text-xl font-semibold">Your recordings stay yours.</h2>
          </div>
          <div className="grid gap-5 text-[13.5px] leading-relaxed text-muted sm:grid-cols-2">
            <p><span className="font-medium text-ink">Encrypted, private storage.</span> Every file is encrypted at rest and only streamed to its owner after authentication. There are no public links.</p>
            <p><span className="font-medium text-ink">Minimal retention.</span> Audio is deleted automatically after your retention period, or right after analysis if you choose.</p>
            <p><span className="font-medium text-ink">No training on your audio.</span> Recordings are never used to train models.</p>
            <p><span className="font-medium text-ink">No speaker identification.</span> Detecting voice cloning is not the same as identifying a person, and Audio Sentinel does not attempt it.</p>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-[12px] text-faint sm:flex-row">
        <Logo />
        <span>Indicators for expert review — not proof of manipulation or authenticity.</span>
      </footer>
    </div>
  );
}
