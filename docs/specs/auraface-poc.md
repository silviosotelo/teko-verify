# AuraFace-v1 PoC — recognizer swap evaluation (READ-ONLY)

**Date:** 2026-06-17 · **Status:** PoC, no code/pipeline/deploy changes made.

## Goal
The current ArcFace recognizer (`recognizer.onnx`, "facenox") is **non-commercial**
(InsightFace weights). Candidate replacement: **`fal/AuraFace-v1`** — ArcFace R100,
ONNX, **Apache-2.0**, 112×112 drop-in. This PoC validates that AuraFace gives good
genuine/impostor separation on **real evidence faces** before committing the swap.

## Setup
- **Model:** `fal/AuraFace-v1` → `glintr100.onnx` (ArcFace R100, 512-D, 112×112).
  - Downloaded from HF (`https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx`,
    `curl -k` for the corp MITM), 260 MB, valid ONNX. License **Apache-2.0** confirmed
    in repo tags + `cardData` + `LICENSE.md`. (Repo also ships the same
    `scrfd_10g_bnkps.onnx` detector we already use.)
- **Faces:** real evidence pulled from `teko-postgres-1` / `teko-teko-verify-1`:
  - **Genuine subject = SOTELO MACHUCA, SILVIO ANDRES (CI 4895448)** — multiple
    verified sessions, each selfie + `doc_front` (cédula).
  - **Impostors:** KOHN SANCHEZ (CI 12577907), CABALLERO BOGARIN (CI 2484930),
    and a **different person also surnamed SOTELO (CI 2962683)** — adversarial
    same-surname case.
- **Cropping:** reused the existing **SCRFD detector + arcface-112 similarity-transform
  alignment** from `src/engine.ts` (`detect`→`bestFace`→`alignToRaw`) ONLY to produce
  the aligned 112×112 RGB crop. The SAME crop feeds both recognizers (no JPEG round-trip).
- **AuraFace preprocessing = identical to facenox:** RGB, `(x-127.5)/127.5`, NCHW,
  512-D output, L2-normalized. Cosine = dot product. AuraFace IO names `data`→`1333`
  (engine already addresses inputs/outputs by index → true drop-in).
- Script: `/tmp/auraface-poc.cjs` (throwaway, run inside the container with
  `NODE_PATH=/app/node_modules`). No crops/PII written to disk; all in memory.

## Results (cosine)

| Pair | type | **AuraFace** | facenox (current) |
|---|---|---|---|
| SOT1 selfie ↔ SOT1 cédula | genuine (cross-modality) | 0.4776 | 0.6635 |
| SOT2 selfie ↔ SOT2 cédula | genuine (cross-modality) | 0.4964 | 0.6786 |
| SOT3 selfie ↔ SOT3 cédula | genuine (cross-modality) | 0.4467 | 0.6808 |
| SOT1 selfie ↔ SOT2 selfie | genuine (selfie↔selfie) | **0.9057** | 0.9043 |
| SOT1 selfie ↔ SOT2 cédula | genuine (cross-session) | 0.4506 | 0.6793 |
| SOT1 selfie ↔ KOHN selfie | impostor | 0.2159 | 0.1815 |
| SOT1 selfie ↔ CABALLERO selfie | impostor | 0.0572 | 0.0394 |
| SOT1 selfie ↔ other-SOTELO selfie | impostor (same surname!) | 0.2264 | 0.1604 |
| SOT2 selfie ↔ KOHN cédula | impostor | -0.0043 | -0.0453 |
| KOHN selfie ↔ CABALLERO selfie | impostor | 0.0677 | 0.0206 |

**Aggregate**

| | AuraFace | facenox |
|---|---|---|
| genuine min / avg / max | 0.4467 / 0.5554 / 0.9057 | 0.6635 / 0.7213 / 0.9043 |
| impostor min / avg / max | -0.0043 / 0.1126 / 0.2264 | -0.0453 / 0.0713 / 0.1815 |
| **separation gap** (genuine.min − impostor.max) | **+0.2203** | +0.4820 |

SCRFD detected a face on all 11 images (det score 0.80–0.91, incl. laminated cédula photos).

## Analysis
- **AuraFace separates correctly: every genuine > every impostor, zero overlap**, including
  the adversarial same-surname/different-person pair (0.2264 genuine-floor margin survives it).
- **Cosine scale is compressed vs ArcFace/facenox.** Same-modality (selfie↔selfie) is
  on par (0.906 vs 0.904), but **cross-modality genuine (live selfie ↔ printed cédula
  photo)** — the actual production 1:1 use case — lands at **~0.45–0.50** vs facenox's
  ~0.66–0.68. Impostors sit at ~0.06–0.23 (same ballpark as facenox).
- Net: the genuine band drops but the impostor band does not, so the **margin halves**
  (≈0.22 vs ≈0.48). Still clean here, but the safety cushion is smaller and the threshold
  **must be recalibrated** — the current facenox match threshold (~0.50, verified sessions
  ran 0.54–0.68) would **false-reject every genuine** under AuraFace.

## Suggested threshold (recalibration required)
- Sample midpoint = (genuine.min 0.4467 + impostor.max 0.2264)/2 ≈ **0.337**.
- **Recommended AuraFace match threshold ≈ 0.35** (accepts all 5 genuine, rejects all 5
  impostors here). Add a **review band ~0.30–0.40** given the thinner margin.
- Do **not** reuse the facenox 0.50 operating point — it is calibrated to a different scale.

## Verdict: **VIABLE drop-in, with recalibration (conditional GO)**
- ✅ Apache-2.0 (licensing blocker solved). ✅ Identical preprocessing/alignment/112-input/512-D
  → swap = replace `recognizer.onnx` + retune one threshold env (no engine code change).
- ✅ Correct ranking, zero overlap incl. same-surname adversarial.
- ⚠️ **Recalibrate threshold down to ~0.35** (+ review band). The compressed cross-modality
  genuine scores make the old threshold unusable.
- ⚠️ **Thinner margin than facenox** (~0.22 vs ~0.48) on the selfie↔document case that
  matters in prod — validate on a **larger labelled eval set** (more identities, glasses,
  lighting, old vs new cédula) before flipping default.
- ⚠️ **Operational cost:** glintr100 R100 is **260 MB vs the current 7 MB** recognizer →
  notably heavier/slower CPU inference and memory. Benchmark latency on the 34 before cutover.
- Detector: current **SCRFD already detects well** (0.80–0.91 on all images); the optional
  permissive-detector swap (YuNet/BlazeFace) is **not urgent**.

**Bottom line:** swap is technically sound and unblocks the commercial-license problem.
Gate it on (1) threshold recalibration to ~0.35 + review band, (2) a larger eval-set
confirmation of the thinner cross-modality margin, (3) a CPU latency/memory benchmark
(R100 is ~37× bigger than the current recognizer).
