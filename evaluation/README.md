# Evaluation and calibration suite

Two scripts measure detection performance on data that was **not** used to train any detector and
write the calibration files that the application uses for thresholds and verdicts. All metrics in the
application and in `docs/EVALUATION.md` come from these scripts; nothing is hard-coded.

Run from the repository root with the backend's environment (ML extras installed, weights downloaded).

## Datasets

| Dataset | Use | Licence | Obtain |
|---------|-----|---------|--------|
| In-the-Wild (Müller et al., 2022) — 31,779 clips of 58 public figures, genuine and deepfake, from online media | Synthetic-speech calibration and held-out test (speaker-disjoint halves) | CC BY-SA 4.0 (original); Apache-2.0 packaging | `huggingface.co/datasets/SpeechAntiSpoofingBenchmarks/InTheWild` (`data/test-*.parquet`) |
| LibriSpeech dev-clean (Panayotov et al., 2015) — read English audiobooks, 40 speakers | Edit benchmark source audio; out-of-domain genuine speech for false-positive checks | CC BY 4.0 | `openslr.org/12` |

Neither dataset was used to train AntiDeepfake or AASIST (In-the-Wild is listed by the AntiDeepfake
authors as a held-out test set). **Note:** LibriTTS — derived from the same LibriVox recordings as
LibriSpeech — *was* in AntiDeepfake's training data, so LibriSpeech false-positive rates for that
model are optimistic; In-the-Wild is the primary held-out benchmark.

Recommended additional datasets for operators (not run here because of download size or licence
terms): ASVspoof 2021 DF / ASVspoof 5 (codec and channel variation; note they *were* AntiDeepfake
training data), MLAAD + M-AILABS (38 languages), Deepfake-Eval-2024 (2024-era generators, held out by
AntiDeepfake), PartialSpoof (segment-level localisation), and in-house recordings from the target
domain (phone calls, voice notes, interviews).

## Synthetic-speech detectors

```bash
backend/.venv/bin/python evaluation/synthetic_eval.py \
    --itw /data/itw --librispeech /data/LibriSpeech/dev-clean --write-calibration \
    [--models antideepfake-w2v2-small,aasist] [--max-per-split N] [--condition-clips 600] [--partial 150]
```

* Clips are split by **speaker** (SHA-256 of the name) into calibration and test halves.
* One window per clip (central 4 s, or the whole clip if shorter) is scored exactly as the deployed
  pipeline scores each 4 s window.
* Calibration half: Platt scaling with balanced class weights (calibrated probabilities assume equal
  prior odds); thresholds at the 95th ("possible") and 99th ("strong") percentile of calibrated genuine
  scores, i.e. a target false-positive rate of 5% and 1% per window.
* Test half: EER, ROC AUC, TPR/FPR at both thresholds, results by clip length, and by condition on a
  balanced subset re-encoded as MP3 64 kbit/s, AAC 48 kbit/s, Opus 16 kbit/s (voice note), 8 kHz
  telephone band, and pink noise at 10 dB SNR.
* Partial-spoof localisation: a deepfake clip inserted between two genuine clips of the same speaker;
  reports how often the synthetic part is flagged and how often genuine windows are flagged.
* A detector may influence verdicts only if its held-out EER ≤ 15% and AUC ≥ 0.90; otherwise its
  calibration file sets `use_for_verdict: false` and its scores are shown for reference only.

## Edit and splice detection

```bash
backend/.venv/bin/python evaluation/edit_benchmark.py \
    --librispeech /data/LibriSpeech/dev-clean --per-split 100 --workers 2 --write-calibration
```

* Speaker-disjoint calibration/test halves of LibriSpeech dev-clean utterances ≥ 12 s.
* Each utterance yields an unedited file and one edited file with exactly known splice times. Eight
  manipulation types: hard cut, crossfaded cut, insertion from the same speaker's other session,
  insertion from another speaker (level-matched), duplicated segment, inserted digital silence,
  insertion recorded in a noisier room, insertion through a telephone channel. Half of the splice
  points are in pauses, half in running speech.
* Every file is also rendered as MP3 64 kbit/s and Opus 24 kbit/s.
* Calibration half: family weights from per-family precision; reporting threshold = lowest fused score
  with ≤ 1 false finding per 10 minutes of unedited audio; high-severity threshold ≤ 0.2 per 10 minutes.
* Test half: boundary recall (a finding within ±0.5 s of a true splice), file detection rate, finding
  precision, false findings per 10 minutes of unedited audio, file-level FPR/FNR, localisation error, by
  manipulation, by codec and by splice position.

Unedited LibriSpeech utterances are themselves excerpts of edited LibriVox readings, so false-positive
rates are upper bounds. Synthetic edits approximate, but do not cover, real editing practice.

## Outputs

* `backend/calibration/edit_detectors.json`, `backend/calibration/synthetic/<detector>.json`,
  `backend/calibration/evaluation_summary.json` — consumed by the application.
* `evaluation/results/*.json` — full metric records.
* `evaluation/work/` — score caches (safe to delete; not committed).

## Adding a dataset

Any labelled corpus can be evaluated by producing clips in the same structure as `load_itw()` returns
(`id`, `label` 1 = synthetic, `speaker`/group for the split, 16 kHz mono audio). Keep groups disjoint
between calibration and test, never calibrate on a model's training data, and record the dataset and
its licence in the calibration file's `provenance`.
