# Architecture

```
 Browser (React SPA)                   API process (FastAPI)                     Worker process(es)
 ───────────────────                   ─────────────────────                     ──────────────────
 upload / record ──raw bytes──▶  /api/recordings  ──sniff+probe──▶ encrypt ──▶  Object storage
 timeline ◀──Range audio, peaks,       (auth, CSRF, rate limits,      (AES-GCM)   (local disk / S3,
            spectrogram tiles──        ownership checks)                           private)
 analyse  ──────────────────────▶  /api/…/analyses ──▶ jobs table ◀──claim (SKIP LOCKED)──┐
 report   ◀──────────────────────  results (JSONB) ◀──────────── write results ◀── analysis pipeline
 PDF      ◀── generated on demand                                                   (signal checks +
                                                                                    ML detectors)
                                      PostgreSQL: users, sessions, recordings, analyses,
                                      comparisons, jobs, audit_events, worker_heartbeats
```

## Components

| Path | Responsibility |
|------|----------------|
| `backend/app/main.py` | App factory, middleware (security headers, CSRF, body limits), SPA serving |
| `backend/app/security.py` | Argon2id passwords, opaque server-side sessions, CSRF/Origin checks, headers |
| `backend/app/storage/` | Chunked AES-256-GCM object encryption (HKDF per-object keys), local and S3 backends |
| `backend/app/media.py` | Magic-byte sniffing, sandboxed ffprobe/ffmpeg (forced demuxer, `file`-only protocol) |
| `backend/app/jobs/` | Database job queue, worker loop, heartbeats, stale-job recovery |
| `backend/app/services/` | Ingest, analysis and comparison jobs, retention, audit log |
| `backend/app/analysis/` | Feature extraction, VAD, detectors, fusion, verdicts, comparison, visuals |
| `backend/app/analysis/synthetic/` | Pluggable synthetic-speech detectors and window scoring |
| `backend/app/reports/pdf.py` | ReportLab PDF reports |
| `backend/calibration/` | Versioned calibration files produced by the evaluation suite |
| `frontend/src/` | SPA: pages, forensic timeline (wavesurfer.js), report and comparison views |
| `evaluation/` | Benchmarks, calibration and evaluation scripts |

## Data model

* `users` — credentials (Argon2id), privacy settings (retention days, delete-after-analysis, consent flag).
* `sessions` — SHA-256 of opaque session tokens, expiry, last use.
* `recordings` — file identity (original name, detected format, size, **SHA-256**), probed media info,
  opaque storage keys of the encrypted original and derived assets, retention expiry, purge time.
* `analyses` — scope (whole file or segment), status/progress, pipeline version, verdict and the
  complete result document (JSONB) so that reports are reproducible from stored results.
* `comparisons` — original/suspect recordings, status, result document.
* `jobs` — the work queue (kind, payload, attempts, run-after, lock, heartbeat, dedupe key).
* `audit_events` — chain of custody: upload, processing, analyses, downloads, report generation, deletion.
* `worker_heartbeats` — worker liveness and the detector status each worker reports.

Audio never enters the database. Reports are not stored; they are generated from the stored result.

## Analysis pipeline

1. **Decode** the original once with FFmpeg to mono float32 at the native rate (capped at 48 kHz), plus a
   16 kHz copy for speech features.
2. **Features** (16 kHz, 10 ms hop): frame energy, 40-band log-mel, MFCC; **VAD** with a minimum-statistics
   noise floor and hysteresis, producing speech, background and digital-silence masks.
3. **Signal checks** (each in `analysis/detectors/`, isolated so one failure cannot abort the analysis):

   | Check | Family | Principle |
   |-------|--------|-----------|
   | Bandwidth consistency | spectral | Steep spectral cliff tracked in 1 s windows; shifts confirmed by band-energy contrast |
   | Background noise continuity | background | Nearest 0.3 s of pause audio before/after each instant, per-band significance |
   | Acoustic change (ΔBIC) | spectral | BIC change detection on MFCC of speech (capped: speaker changes look alike) |
   | Waveform discontinuities | waveform | Isolated sub-3 ms high-pass bursts; DC-offset steps |
   | Digital silence | waveform | Exact-silence runs inside a noisy recording; noise-gate pattern recognition |
   | Speech level steps / pitch continuity | prosody | Supporting evidence only (capped strengths) |
   | Room acoustics | acoustics | Truncated decays at word endings; decay-rate changes |
   | Duplicated segments | duplication | 32-bit fingerprints, offset voting, BER + waveform correlation, sample identity |
   | Mains hum (ENF) | enf | Phase-continuity test on demodulated 50/60 Hz hum, applicability gated on hum SNR |

4. **Synthetic-speech detectors** score overlapping 4 s windows (2 s hop) that contain ≥ 1 s of speech.
   Raw scores are log-odds of "synthetic"; calibrated probabilities use Platt parameters from the
   detector's calibration file. Flagged windows are merged into "Possible synthetic speech" regions.
5. **Fusion**: candidates are clustered in time (±0.3 s); each family contributes its strongest candidate;
   families are combined by weighted noisy-OR. Clusters at or above the *report* threshold become findings
   (*Possible edit*, *Acoustic discontinuity*, *Possible duplicated segment*); weaker ones are listed as
   observations below threshold.
6. **Assessments**: editing (strong/possible/none/inconclusive), synthetic speech (only detectors with
   `use_for_verdict` in their calibration file count; otherwise *Inconclusive* or *Detection model not
   configured*), quality (blocking issues make a clean result *Inconclusive*), metadata (file-level
   leads). The overall verdict never reads "No significant indicators" when synthetic speech was not
   assessed.
7. **Result document** with findings, evidence, observations, per-window ML scores, detector statuses and
   versions, calibration provenance, quality, metadata, limitations, recommendations and environment versions.

## Key decisions

* **Database-backed queue** instead of a separate broker: one fewer service, transactional enqueue with
  the analysis row, and `SKIP LOCKED` gives safe concurrency across worker processes.
* **Raw-body uploads** streamed to a private temp file with a hard byte limit (multipart parsers spool to
  shared temp directories and enforce limits late).
* **Opaque sessions in HttpOnly SameSite=Strict cookies** instead of bearer tokens: no token in
  JavaScript, revocable, and `<audio>`/`<img>` requests authenticate without exposing URLs.
* **Server-side spectrogram tiles and peaks**: the browser never decodes the whole file, works for long
  recordings, and the displayed spectrum is the one the analysis used (full native band).
* **Chunked authenticated encryption** so HTTP range requests decrypt only the chunks they need.
* **Fairseq → Transformers weight mapping** for AntiDeepfake, avoiding an unmaintained fairseq dependency.
* **Calibration as data**: thresholds live in versioned JSON files written by the evaluation suite, with
  provenance displayed to users; code defaults are labelled as unvalidated.
