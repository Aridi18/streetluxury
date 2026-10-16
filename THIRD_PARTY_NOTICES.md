# Third-party notices

Audio Sentinel uses the following third-party models, datasets and software. Licences of
pretrained model weights restrict how a deployment may be used; read this before deploying.

## Pretrained models

### NII AntiDeepfake — Wav2Vec2-Small (`antideepfake-w2v2-small`)

* Source: https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake (revision `9a13264b5dcc827a8d5a4f8e01fccefa392f886b`)
* Authors: Yamagishi Lab, National Institute of Informatics (NII), Japan.
  W. Ge et al., "Post-training for Deepfake Speech Detection", arXiv:2506.21090 (2025).
* **Weights licence: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0).**
  The weights are made available for research and educational purposes. **Commercial use is not
  permitted** without a separate licence from NII. Operators of commercial deployments must disable
  this detector (`AS_SYNTHETIC_DETECTORS`) or obtain a licence.
* Code licence (upstream repository): BSD-3-Clause. Audio Sentinel does not include upstream code;
  it loads the published weights into the equivalent Hugging Face `Wav2Vec2Model` architecture.
* The weights are downloaded by `python -m app.cli download-models` and are not distributed with this repository.

### AASIST (`aasist`)

* Source: https://github.com/clovaai/aasist — J. Jung et al., "AASIST: Audio Anti-Spoofing using
  Integrated Spectro-Temporal Graph Attention Networks", ICASSP 2022.
* The model architecture file `backend/app/analysis/synthetic/aasist_model.py` is vendored verbatim.
* Licence: MIT (code and released weights). Full text:

```
Copyright (c) 2021-present NAVER Corp.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Evaluation datasets (not distributed; downloaded by the operator)

* **In-the-Wild** (Müller et al., "Does Audio Deepfake Detection Generalize?", Interspeech 2022).
  Original release: https://deepfake-total.com/in_the_wild, CC BY-SA 4.0 (as stated on
  https://huggingface.co/datasets/mueller91/In-The-Wild). Packaged copy used for evaluation:
  https://huggingface.co/datasets/SpeechAntiSpoofingBenchmarks/InTheWild (redistributed under Apache-2.0).
* **LibriSpeech** (Panayotov et al., ICASSP 2015), https://www.openslr.org/12, CC BY 4.0.

## Software

| Component | Licence |
|-----------|---------|
| FFmpeg (external binary, invoked as a process) | LGPL-2.1+ / GPL depending on build |
| FastAPI, Starlette, Pydantic, Uvicorn | MIT / BSD-3-Clause |
| SQLAlchemy, Alembic | MIT |
| psycopg | LGPL-3.0 |
| NumPy, SciPy, soundfile, soxr | BSD-3-Clause / BSD / LGPL-2.1 (libsoxr) |
| librosa | ISC |
| PyTorch | BSD-3-Clause |
| Hugging Face Transformers, safetensors, huggingface_hub | Apache-2.0 |
| ReportLab | BSD |
| Pillow | MIT-CMU (HPND) |
| argon2-cffi, cryptography | MIT / Apache-2.0 or BSD |
| redis-py, boto3 | MIT / Apache-2.0 |
| React, React Router, TanStack Query | MIT |
| wavesurfer.js | BSD-3-Clause |
| Radix UI primitives, class-variance-authority, clsx, tailwind-merge, sonner | MIT |
| Tailwind CSS, Vite | MIT |
| lucide-react | ISC |
