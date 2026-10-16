export type Verdict = "none" | "possible" | "strong" | "inconclusive";
export type ComponentStatus = Verdict | "not_configured";
export type Severity = "high" | "medium" | "low";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  retention_days: number;
  delete_audio_after_analysis: boolean;
  research_consent: boolean;
  research_consent_at: string | null;
}

export interface AnalysisSummary {
  id: string;
  status: JobStatus;
  verdict: Verdict | null;
  created_at: string;
  segment_start: number | null;
  segment_end: number | null;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SpectrogramTile {
  index: number;
  start: number;
  end: number;
}

export interface Recording {
  id: string;
  title: string | null;
  original_filename: string;
  source: "upload" | "microphone" | "voice_note";
  detected_format: string | null;
  size_bytes: number;
  sha256: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  channels: number | null;
  codec: string | null;
  bit_rate: number | null;
  created_at: string;
  audio_expires_at: string | null;
  audio_purged_at: string | null;
  has_audio: boolean;
  playback_transcoded: boolean;
  spectrogram: { tiles: SpectrogramTile[]; max_freq_hz: number } | null;
  media_info: Record<string, unknown> | null;
  latest_analysis: AnalysisSummary | null;
}

export interface Evidence {
  detector: string;
  family: string;
  start: number;
  end: number;
  strength: number;
  measurements: Record<string, unknown>;
  explanation: string;
  alternatives: string[];
  related?: { source_start: number; source_end: number } | null;
  kind: "boundary" | "interval" | "pair";
}

export interface Finding {
  id: string;
  start: number;
  end: number;
  score: number;
  label: string;
  severity: Severity;
  category: "edit" | "duplication" | "synthetic";
  families: Record<string, number>;
  evidence: Evidence[];
  related?: { source_start: number; source_end: number } | null;
  summary: string;
  supporting: { detector: string; family: string; strength: number; explanation: string }[];
  alternatives: string[];
  confirmed: boolean;
  basis: string;
  detector?: string;
}

export interface Observation {
  id: string;
  start: number;
  end: number;
  score: number;
  label: string;
  families: Record<string, number>;
}

export interface Assessment {
  status: ComponentStatus;
  label: string;
  reasons: string[];
  checks_run?: string[];
  checks_not_applicable?: { id: string; name: string; detail: string }[];
  detectors?: string[];
  voting_detectors?: string[];
}

export interface QualityIssue {
  code: string;
  severity: "info" | "warning" | "severe";
  title: string;
  detail: string;
  affects: string[];
}

export interface Quality {
  duration_seconds: number;
  speech_seconds: number;
  speech_ratio: number;
  noise_floor_dbfs: number;
  speech_level_dbfs: number | null;
  snr_db: number | null;
  clipping_ratio: number;
  peak_dbfs: number;
  effective_bandwidth_hz: number | null;
  speech_segments: number;
  background_seconds: number;
  issues: QualityIssue[];
  overall: "good" | "fair" | "poor";
  blocks: { edit: boolean; synthetic: boolean };
}

export interface SyntheticWindow {
  start: number;
  end: number;
  speech_s: number;
  scored: boolean;
  raw_score?: number;
  p_model?: number;
  p_calibrated?: number;
  flag: "none" | "possible" | "strong" | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  architecture: string;
  training_data: string;
  license: string;
  license_url: string;
  commercial_use: boolean;
  source_url: string;
  paper: string;
  published_results: { dataset: string; eer_percent?: number; roc_auc?: number; source: string }[];
  notes: string[];
}

export interface SyntheticDetail {
  status: string;
  status_detail: string | null;
  windows?: SyntheticWindow[];
  windows_total?: number;
  windows_scored?: number;
  calibrated?: boolean;
  use_for_verdict?: boolean;
  thresholds?: { possible: number; strong: number } | null;
  probability_key?: "p_calibrated" | "p_model";
  mean_probability?: number;
  median_probability?: number;
  max_probability?: number;
  sustained_max_probability?: number;
  fraction_possible?: number | null;
  fraction_strong?: number | null;
  calibration_provenance?: Record<string, unknown> | null;
  model?: ModelInfo;
  state?: string;
}

export interface DetectorRun {
  id: string;
  name: string;
  family: string;
  version: string;
  kind: "signal" | "ml";
  method: string;
  status: "ok" | "not_applicable" | "failed" | "skipped";
  status_detail: string | null;
  summary: Record<string, unknown>;
  runtime_s: number;
  n_candidates: number;
}

export interface MetadataFinding {
  id: string;
  severity: "info" | "notice" | "warning";
  title: string;
  detail: string;
}

export interface AnalysisResult {
  pipeline_version: string;
  analysed_at: string;
  scope: { whole_file: boolean; start: number; end: number };
  overall: { status: Verdict; label: string; caveats: string[]; components: { editing: ComponentStatus; synthetic: ComponentStatus }; quality: string };
  assessments: { editing: Assessment; synthetic: Assessment };
  findings: Finding[];
  observations: Observation[];
  thresholds: { observation: number; report: number; high: number };
  synthetic: Record<string, SyntheticDetail>;
  detectors: DetectorRun[];
  quality: Quality;
  metadata: { summary: Record<string, unknown> & { tags?: Record<string, string> }; findings: MetadataFinding[]; note: string };
  speech_segments: [number, number][];
  recommendations: string[];
  limitations: string[];
  calibration: { editing: Record<string, unknown>; synthetic: Record<string, Record<string, unknown> | null> };
  environment: { analysis_sample_rate: number; versions: Record<string, string> };
  timing: Record<string, number>;
  file: {
    recording_id: string;
    title: string | null;
    filename: string;
    source: string;
    sha256: string;
    size_bytes: number;
    format: string;
    codec: string;
    duration_seconds: number;
    sample_rate: number;
    channels: number;
    bit_rate: number | null;
    uploaded_at: string;
  };
}

export interface RecordingBrief {
  id: string;
  title: string | null;
  original_filename: string;
  duration_seconds: number | null;
  source: string;
  has_audio: boolean;
}

export interface Analysis {
  id: string;
  recording_id: string;
  status: JobStatus;
  stage: string | null;
  progress: number;
  segment_start: number | null;
  segment_end: number | null;
  verdict: Verdict | null;
  error: string | null;
  pipeline_version: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: AnalysisResult | null;
  recording_info: RecordingBrief | null;
  findings_count?: number;
  components?: { editing: ComponentStatus; synthetic: ComponentStatus };
}

export interface ComparisonSegment {
  type: "matched" | "added" | "changed" | "unmatched";
  b_start: number;
  b_end: number;
  a_start?: number;
  a_end?: number;
  similarity?: number;
  polarity_inverted?: boolean;
  level_difference_db?: number;
  spectral_shape_difference_db?: number | null;
  speed_ratio?: number | null;
  fingerprint_bit_error_rate?: number;
  duration_s?: number;
  speech_fraction?: number;
  content?: string;
}

export interface ComparisonResult {
  pipeline_version: string;
  method: string;
  summary: {
    original_duration_s: number;
    suspect_duration_s: number;
    duration_difference_s: number;
    matched_suspect_s: number;
    matched_original_s: number;
    matched_fraction_suspect: number;
    matched_fraction_original: number;
    matched_segments: number;
    added_segments: number;
    changed_segments: number;
    removed_segments: number;
    reordered_boundaries: number;
    splice_points: number;
    mean_similarity: number | null;
    median_level_difference_db: number | null;
    shares_content: boolean;
  };
  timeline: ComparisonSegment[];
  removed: { a_start: number; a_end: number; duration_s: number; speech_fraction: number; kind: string }[];
  splice_points: { b_time: number; b_resume: number; a_from: number; a_to: number; kind: string; a_jump_s: number; b_gap_s: number }[];
  notes: string[];
  original: AnalysisResult["file"];
  suspect: AnalysisResult["file"];
}

export interface Comparison {
  id: string;
  original_id: string;
  suspect_id: string;
  status: JobStatus;
  stage: string | null;
  progress: number;
  error: string | null;
  pipeline_version: string | null;
  created_at: string;
  finished_at: string | null;
  result: ComparisonResult | null;
  original_info: RecordingBrief | null;
  suspect_info: RecordingBrief | null;
  summary?: ComparisonResult["summary"];
}

export interface DetectorStatus extends ModelInfo {
  state: "ready" | "not_configured" | "unavailable";
  detail: string | null;
  loaded: boolean;
  enabled: boolean;
  calibration: {
    calibrated: boolean;
    use_for_verdict: boolean;
    note?: string;
    thresholds?: { possible: number; strong: number };
    provenance?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    created_at?: string;
  };
}

export interface SystemStatus {
  pipeline_version: string;
  ffmpeg: string;
  workers: { id: string; hostname: string; online: boolean; last_seen_at: string; current_job_id: number | null }[];
  workers_online: number;
  queue: { counts: Record<string, number>; oldest_queued_at: string | null };
  signal_checks: { id: string; name: string; family: string; description: string; state: string }[];
  synthetic_detectors: DetectorStatus[];
  synthetic_source: string;
  calibration: { editing: { version: string; provenance: Record<string, unknown>; fusion: Record<string, unknown> } };
  evaluation: Record<string, unknown> | null;
  storage: { backend: string; encryption: string; public_urls: boolean };
  limits: { max_upload_mb: number; max_duration_minutes: number; formats: string };
  retention: { default_days: number; max_days: number; reports_stored: boolean };
  rate_limiting: { enabled: boolean; backend: string };
  environment: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}
