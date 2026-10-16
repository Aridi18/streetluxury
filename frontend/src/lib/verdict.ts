import type { ComponentStatus, Severity } from "./types";

export const VERDICT_TEXT: Record<ComponentStatus, string> = {
  none: "No significant manipulation indicators detected",
  possible: "Possible manipulation detected",
  strong: "Strong indicators of synthetic or manipulated audio",
  inconclusive: "Inconclusive — more evidence required",
  not_configured: "Detection model not configured",
};

export const VERDICT_SHORT: Record<ComponentStatus, string> = {
  none: "No significant indicators",
  possible: "Possible manipulation",
  strong: "Strong indicators",
  inconclusive: "Inconclusive",
  not_configured: "Not configured",
};

export const VERDICT_STYLE: Record<ComponentStatus, { fg: string; bg: string; ring: string; dot: string }> = {
  none: { fg: "text-ok", bg: "bg-ok-bg", ring: "ring-ok/30", dot: "bg-ok" },
  possible: { fg: "text-sev-medium", bg: "bg-sev-medium-bg", ring: "ring-sev-medium/30", dot: "bg-sev-medium" },
  strong: { fg: "text-sev-high", bg: "bg-sev-high-bg", ring: "ring-sev-high/30", dot: "bg-sev-high" },
  inconclusive: { fg: "text-ink-soft", bg: "bg-raised", ring: "ring-line-strong", dot: "bg-muted" },
  not_configured: { fg: "text-muted", bg: "bg-raised", ring: "ring-line-strong", dot: "bg-faint" },
};

export const SEVERITY_STYLE: Record<Severity | "synthetic", { fg: string; bg: string; region: string; label: string }> = {
  high: { fg: "text-sev-high", bg: "bg-sev-high-bg", region: "rgba(251,113,133,0.22)", label: "High" },
  medium: { fg: "text-sev-medium", bg: "bg-sev-medium-bg", region: "rgba(251,191,36,0.18)", label: "Medium" },
  low: { fg: "text-sev-low", bg: "bg-raised", region: "rgba(161,161,181,0.12)", label: "Low" },
  synthetic: { fg: "text-synthetic", bg: "bg-synthetic-bg", region: "rgba(192,132,252,0.20)", label: "Synthetic" },
};

export const FAMILY_LABEL: Record<string, string> = {
  background: "Background noise",
  spectral: "Spectral / bandwidth",
  waveform: "Waveform",
  prosody: "Level & pitch",
  acoustics: "Room acoustics",
  enf: "Mains hum (ENF)",
  duplication: "Duplicated audio",
  synthetic: "Synthetic speech model",
};

export const SOURCE_LABEL: Record<string, string> = {
  upload: "Uploaded file",
  microphone: "Microphone recording",
  voice_note: "Voice note",
};
