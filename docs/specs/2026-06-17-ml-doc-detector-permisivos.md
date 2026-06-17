# Detector de documento/cédula client-side — modelos con licencia PERMISIVA

**Fecha:** 2026-06-17
**Contexto:** Teko Verify (KYC, SaaS comercial cerrado, on-prem). Se busca un detector de documento/ID-card que corra en navegador (onnxruntime-web, Web Worker) y devuelva las **4 esquinas (quad)** del documento. Reemplaza/complementa el detector geométrico OpenCV actual; el gating geométrico (nitidez/reflejo/relleno) queda como post-filtro.
**Restricción dura:** licencia **permisiva** (Apache-2.0 / MIT / BSD). **Descartados por AGPL:** YOLOv8 / YOLO26 (Ultralytics).

---

## Tabla rankeada (verificada en la fuente)

| # | Modelo | Origen | Licencia (verificada) | Tamaño | Salida | ¿Pesos de documento/ID listos? | Browser-ready | Esfuerzo | Veredicto |
|---|--------|--------|------------------------|--------|--------|-------------------------------|---------------|----------|-----------|
| 1 | **DocAligner** (DocsaidLab) | [github.com/DocsaidLab/DocAligner](https://github.com/DocsaidLab/DocAligner) · [docsaid.org](https://docsaid.org/en/docs/docaligner/) | **Apache-2.0** ✓ | LC050 **0.4M / 1.7MB FP32** (~<1MB int8); LC100 1.2M/4.9MB; FastViT_T8 3.3M/13.1MB | **4 esquinas** (heatmap regression → quad) | **SÍ** — pesos ONNX preentrenados en documentos, auto-descarga, listo out-of-the-box. Jaccard 0.98+ en SmartDoc-2015 | **SÍ** (ONNX, lightweight) | **S** | **GANADOR. Drop-in.** |
| 2 | **ternaus/midv-500-models** | [github.com/ternaus/midv-500-models](https://github.com/ternaus/midv-500-models) | **MIT** ✓ | UNet+ResNet34 ~**83MB** | Máscara seg → contorno → quad | **SÍ** — entrenado en **MIDV-500 (ID docs reales)** | Sí (export ONNX), pero **demasiado pesado** | M | Backup de datos/labels; modelo muy grande para browser. |
| 3 | **RTMPose / RTMDet** (OpenMMLab) | [github.com/open-mmlab/mmpose](https://github.com/open-mmlab/mmpose) | **Apache-2.0** ✓ | RTMPose-t tiny, ONNX vía MMDeploy | Pose keypoints (→ 4 corners si se entrena) | **NO** — solo COCO/pose; hay que entrenar las 4 esquinas | Sí (ORT/ncnn/OpenVINO sin PyTorch) | L | Mejor backbone permisivo si DocAligner no alcanza. |
| 4 | **YOLOX** (Megvii) | [github.com/Megvii-BaseDetection/YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) | **Apache-2.0** ✓ | nano/tiny, ONNX | **bbox solo** (no esquinas) | NO (solo COCO) | Sí | L | Bbox no da quad. Solo si se añade cabeza de keypoints + entrenar. |
| 5 | **NanoDet-Plus** (RangiLyu) | [github.com/RangiLyu/nanodet](https://github.com/RangiLyu/nanodet) | **Apache-2.0** ✓ | **980KB int8 / 1.8MB fp16**, 97FPS móvil | **bbox solo** | NO (solo COCO) | Sí (ONNX/MNN) | L | Ultraligero pero bbox; no da esquinas. |
| 6 | **PaddleOCR — PP-DocLayout / PP-PicoDet** | [huggingface.co/PaddlePaddle](https://huggingface.co/PaddlePaddle/PP-DocLayout-S) | **Apache-2.0** ✓ | PicoDet-S, ONNX | Layout bbox (regiones) / unwarping | NO da quad de documento | Sí | L | Tarea distinta (layout/unwarp), no localización de cédula. Complemento opcional. |

> Nota AGPL: YOLOv8/YOLOv11/YOLO26 (Ultralytics) **excluidos**. Confirmado que DocAligner, YOLOX, NanoDet, MMPose, PaddleOCR y ternaus son todos **Apache-2.0 o MIT** verificados en sus archivos LICENSE/badges.

---

## Recomendación

### TOP 1 — DocAligner (DocsaidLab), Apache-2.0 — **adoptar como detector principal**

Es el único candidato que cumple **los cuatro criterios a la vez**, incluido el bonus más valioso (pesos preentrenados en documentos, listos):

- **Licencia:** Apache-2.0 (verificada en el repo). Apto para SaaS KYC comercial cerrado.
- **Salida correcta:** devuelve directamente la **lista de 4 esquinas** del documento (heatmap regression + Adaptive Wing Loss, tratando las esquinas como keypoints). Es exactamente el contrato `quad` que necesita Teko Verify.
- **Browser-ready y diminuto:** ya distribuido en **ONNX**. La variante **LC050 = 0.4M params / 1.7MB FP32** (sub-1MB en int8) — encaja perfecto en onnxruntime-web/Web Worker móvil. LC100 (1.2M/4.9MB) si se quiere más precisión. Jaccard 0.9826–0.9892 en SmartDoc-2015.
- **Pesos listos (cero entrenamiento inicial):** el paquete `docaligner-docsaid` **auto-descarga** los modelos ONNX y funciona out-of-the-box sobre documentos/tarjetas. → **PoC en horas**, no semanas.

**Plan de integración (esfuerzo S):**
1. Tomar el ONNX de `model_cfg` ligero (LC050/LC100) del release/auto-download de DocAligner.
2. Cuantizar a **int8** (onnxruntime quantization) → objetivo <1–2MB.
3. Cargar en **Web Worker** con onnxruntime-web (WASM SIMD, o WebGPU si hay). Pre/post-proc: resize a input fijo → 4 heatmaps → argmax/contorno por esquina → quad en coords originales.
4. Pasar el quad al **gating geométrico actual** (nitidez/reflejo/relleno) como post-filtro. Sin cambios de contrato.
5. Mantener OpenCV como fallback.

**Riesgo a validar:** el set de entrenamiento exacto no está 100% documentado (testean en SmartDoc-2015; usan documentos sintéticos + reales). **Acción:** evaluar el ONNX preentrenado contra un set propio de **cédulas paraguayas** antes de confiar. Si la precisión en cédula PY es insuficiente → fine-tune (ver Top 2).

### TOP 2 — Backbone permisivo + entrenamiento (si DocAligner no generaliza a cédula PY)

Si en la evaluación las cédulas PY caen fuera de distribución, el camino limpio es **fine-tunear/entrenar un detector de 4 corners** propio, todo Apache/MIT:

- **Backbone recomendado:** **RTMPose-tiny** (OpenMMLab, Apache-2.0) configurado con **4 keypoints = esquinas** del documento. Despliegue ONNX vía MMDeploy sin PyTorch en runtime; tiny corre rápido en navegador. Alternativa: re-fine-tune del propio DocAligner (Apache-2.0, ya trae el pipeline de entrenamiento).
- **Datos (todos con licencia usable):**
  - **MIDV-500 / MIDV-2020** — mock IDs con ground-truth de esquinas; labels MIDV + el modelo de segmentación **ternaus/midv-500-models (MIT)** sirven para auto-etiquetar/bootstrap.
  - **SmartDoc-2015** — quads de documentos (benchmark).
  - **Cédulas PY propias** — capturar/etiquetar ~300–1000 con 4 esquinas (clave para el dominio real).
- **Cómputo:** entrenamiento corto en **GPU del server 34 (RTX 5060)** — orden de **horas/pocos días**.
- **Export:** ONNX → cuantización int8 → Web Worker (mismo runtime que Top 1).

---

## Fuentes (licencias verificadas)

- DocAligner — Apache-2.0, salida 4 esquinas, backbones LCNet/MobileNetV2/FastViT, ONNX auto-download: <https://github.com/DocsaidLab/DocAligner> · benchmark/tamaños: <https://docsaid.org/en/docs/docaligner/benchmark/> · quickstart (auto-download, out-of-the-box): <https://docsaid.org/en/docs/docaligner/quickstart/>
- YOLOX — Apache-2.0: <https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE>
- MMPose (RTMPose/RTMDet) — Apache-2.0: <https://github.com/open-mmlab/mmpose/blob/main/LICENSE>
- NanoDet-Plus — Apache-2.0, 980KB int8: <https://github.com/RangiLyu/nanodet/blob/main/LICENSE>
- PaddleOCR PP-DocLayout / PicoDet — Apache-2.0: <https://huggingface.co/PaddlePaddle/PP-DocLayout-S>
- ternaus/midv-500-models — MIT, UNet+ResNet34 sobre MIDV-500: <https://github.com/ternaus/midv-500-models/blob/master/LICENSE>
- MIDV-2020 dataset (ID docs benchmark): <https://arxiv.org/pdf/2107.00396>
