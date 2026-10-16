# Calibration files

Every threshold that can turn evidence into a reported finding or a verdict is read from this directory.
The files are produced by the evaluation suite (`evaluation/`) and record the data and procedure behind them.

| File | Produced by | Used for |
|------|-------------|----------|
| `edit_detectors.json` | `evaluation/edit_benchmark.py --write-calibration` | Fusion family weights, reporting and high-severity thresholds for edit/splice findings |
| `synthetic/<detector>.json` | `evaluation/synthetic_eval.py --write-calibration` | Platt scaling, "possible"/"strong" thresholds and whether the detector may influence verdicts |
| `evaluation_summary.json` | both scripts | Held-out metrics shown on the *Models & system* page |

If a file is missing, the application falls back to built-in engineering defaults (edit detection) or
treats the detector as uncalibrated (synthetic speech: raw scores are shown for reference only and the
synthetic-speech assessment is "Inconclusive"). The report always states which applies.

Re-run the evaluation after changing a detector, a model or its weights, and commit the new files together
with the code change so that the pipeline version and calibration stay consistent.
