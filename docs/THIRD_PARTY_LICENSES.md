# Third-Party Licenses / NOTICE — Teko Verify

**Producto:** Teko Verify (KYC / verificación de identidad, SaaS comercial cerrado, on-prem).
**Fecha de auditoría:** 2026-06-17 · **Alcance:** modelos ML, datasets y librerías de terceros.
**Tipo:** auditoría de compliance (read-only). Licencias **verificadas en la fuente** (repo / model card / npm), no de memoria.

> ⚠️ **Lectura rápida (riesgo central):** el **detector SCRFD** (`scrfd_10g_bnkps.onnx`) y el
> **recognizer ArcFace "facenox"** (`recognizer.onnx`) son, por su procedencia, **pesos pre-entrenados
> de InsightFace**, cuya licencia es **NON-COMMERCIAL (research-only)**. Es el motor biométrico central del
> producto → **bloqueante para go-live comercial** hasta reemplazar los pesos. Detalle en §3.

---

## 1. Tabla resumen por componente

### 1.1 Modelos ML

| Componente | Qué hace · archivo | Origen / URL | Licencia (verificada) | Obligación | ¿Comercial OK? |
|---|---|---|---|---|---|
| **SCRFD-10G** detector de rostro | detección + 5 landmarks · `scrfd_10g_bnkps.onnx` (`src/engine.ts`) | InsightFace (deepinsight) | **Código MIT; pesos pre-entrenados NON-COMMERCIAL** | — | **❌ NO** (pesos research-only) |
| **ArcFace "facenox"** recognizer | embedding facial 512D 1:1 · `recognizer.onnx` (`src/engine.ts`) | ArcFace/InsightFace, vía proyecto `facenox` | **Pesos ArcFace = procedencia InsightFace → NON-COMMERCIAL** (incierto si re-entrenado con datos comerciales) | — | **❌ NO / INCIERTO** |
| **MiniFASNet / Silent-Face** PAD (anti-spoof) | liveness pasivo ×2 ensemble · `pad_minifasnet*.onnx` (`src/modules/liveness.ts`) | minivision-ai/Silent-Face-Anti-Spoofing | **Apache-2.0** (repo + pesos `.pth`) | Aviso Apache (NOTICE) | ✅ Sí |
| **face_attrib_net** (anti-anteojos) | ojos/máscara/anteojos · `face_attrib_net.onnx` (`src/config.ts`) | Qualcomm AI Hub | **Model card = "other"; repo ai-hub-models = BSD-3** | Aviso BSD-3 · **verificar términos AI Hub** | ⚠️ Probable Sí (confirmar) |
| **FairFace ResNet-34** (edad) | estimación de edad del selfie · `age_fairface_res34.onnx` (`src/modules/ageEstimation.ts`) | dchen236/FairFace | **CC BY 4.0** (README + dataset) | **Atribución obligatoria** (ver §2) | ✅ Sí (con atribución) |
| **DocAligner LC050** | 4 esquinas del documento (browser) · `docaligner_lcnet050_fp32.onnx` (`web/public/`) | DocsaidLab/DocAligner | **Apache-2.0** | Aviso Apache | ✅ Sí |
| **MediaPipe** FaceDetector/FaceLandmarker | UX in-browser (encuadre/liveness activo) · `blaze_face_short_range.tflite`, `face_landmarker.task` (`web/public/mediapipe/`) | Google MediaPipe | **Apache-2.0** | Aviso Apache | ✅ Sí |
| **PaddleOCR / PP-OCRv5** | OCR cédula PY (sidecar) · `ocr/app.py` | PaddlePaddle | **Apache-2.0** | Aviso Apache | ✅ Sí |
| **opencv.js** | gating geométrico browser · `web/public/opencv.js` | OpenCV | **Apache-2.0** (OpenCV ≥4.5) | Aviso Apache | ✅ Sí |
| **onnxruntime-web (wasm)** | runtime ONNX browser · `web/public/ort*` | Microsoft | **MIT** | Aviso MIT | ✅ Sí |

### 1.2 Datasets / datos

| Componente | Qué hace · archivo | Origen / URL | Licencia (verificada) | ¿Comercial OK? |
|---|---|---|---|---|
| **OpenSanctions** (AML/PEP) | screening sanciones/PEP local · `scripts/aml-import.mjs`, `aml_entities` | opensanctions.org | **Gratis SOLO no-comercial; comercial requiere licencia** | **❌ NO** (sin licenciar) |

### 1.3 Librerías npm (clave)

| Paquete | Dónde · `package.json` | Licencia (verificada) | ¿Comercial OK? |
|---|---|---|---|
| express, cors, helmet | backend | **MIT** | ✅ |
| mrz (parser MRZ TD1) | backend | **MIT** | ✅ |
| multer | backend (upload) | **MIT** | ✅ |
| nodemailer | backend (mail) | **MIT** | ✅ |
| pg, pino, pino-http | backend | **MIT** | ✅ |
| zod | back + web | **MIT** | ✅ |
| **@zxing/library** (barcode) | backend | **MIT** (verificado en node_modules) | ✅ |
| **sharp** (imágenes) | backend | **Apache-2.0** (verificado) | ✅ |
| onnxruntime-node / -web | back + web | **MIT** | ✅ |
| @mediapipe/tasks-vision | web | **Apache-2.0** | ✅ |
| react, react-dom | web + admin | **MIT** | ✅ |
| **ecme** (template admin) | `admin/` (paquete `"ecme"`) | **Licencia comercial de template (no OSS)** | ⚠️ Requiere licencia comprada válida (ver §3) |
| @teko/verify-sdk | `sdk/` | **UNLICENSED** (propio, cero deps runtime) | n/a (interno) |

> Resto de dependencias transitivas: estándar permisivo (MIT/ISC/BSD/Apache). El stack del admin (ecme)
> incluye decenas de libs OSS permisivas (axios MIT, tailwind MIT, framer-motion MIT, @tanstack MIT,
> firebase Apache-2.0, etc.) — sin copyleft viral detectado. **No se detectó GPL/AGPL/LGPL** en el árbol
> de producción (YOLO/Ultralytics AGPL fue explícitamente **excluido**, ver `docs/specs/2026-06-17-ml-doc-detector-permisivos.md`).

---

## 2. Atribuciones requeridas (texto a incluir en el producto)

Estas licencias **obligan** a mostrar atribución/aviso. Incluir en un "Acerca de / Avisos legales" del
producto y/o en este NOTICE distribuido:

### FairFace (CC BY 4.0) — OBLIGATORIA
> Estimación de edad basada en **FairFace** (modelo `res34_fair_align_multi_7`), © Kärkkäinen & Joo.
> Kärkkäinen, K., & Joo, J. (2021). *FairFace: Face Attribute Dataset for Balanced Race, Gender, and Age
> for Bias Measurement and Mitigation.* WACV 2021. Licencia CC BY 4.0 — https://github.com/dchen236/FairFace

### Apache-2.0 (NOTICE) — MiniFASNet/Silent-Face, DocAligner, MediaPipe, PaddleOCR, OpenCV, sharp
> Este producto incluye software bajo Apache License 2.0:
> - Silent-Face-Anti-Spoofing (MiniFASNet) © minivision-ai
> - DocAligner © DocsaidLab
> - MediaPipe © Google LLC
> - PaddleOCR © PaddlePaddle Authors
> - OpenCV © OpenCV team
> - sharp © Lovell Fuller
> Copia de la licencia: http://www.apache.org/licenses/LICENSE-2.0

### BSD-3 — Qualcomm face_attrib_net
> Incluye Qualcomm AI Hub Models (face_attrib_net) © Qualcomm Technologies, Inc. — BSD-3-Clause.
> (Verificar además los Terms of Use de Qualcomm AI Hub; la model card lista "license: other".)

### MIT — express, mrz, zxing, onnxruntime, react, etc.
> Conservar los avisos de copyright MIT de cada paquete (generables con `license-checker`/`license-checker-rseidelsohn`).

---

## 3. RIESGOS PRIORIZADOS para uso comercial

### 🔴 R1 — CRÍTICO / BLOQUEANTE: SCRFD + ArcFace "facenox" (motor biométrico) son NON-COMMERCIAL
- **Hecho verificado:** el **código** de InsightFace es MIT, pero **todos los pesos pre-entrenados**
  (SCRFD, ArcFace) son *"available for non-commercial research purposes only"* — confirmado en el README
  oficial y en el Issue #2022 del repo deepinsight/insightface. El `scrfd_10g_bnkps.onnx` es el SCRFD
  canónico de InsightFace; el `recognizer.onnx` ArcFace ("facenox") deriva de la misma familia de pesos.
- **Por qué importa:** son el **núcleo** de Teko Verify (detección, alineación, match 1:1, liveness, edad
  y AML dependen del detector). Shippear esto en un SaaS comercial **viola la licencia** de los pesos.
- **Recomendación (elegir uno):**
  1. **Reemplazar el recognizer por `fal/AuraFace-v1`** (ONNX, **Apache-2.0**, entrenado con datos aptos
     para uso comercial; basado en ArcFace → drop-in para el pipeline `embedFromRaw`/112×112).
  2. **Reemplazar el detector SCRFD** por uno permisivo: **YuNet (OpenCV Zoo, Apache-2.0)** o
     **MediaPipe BlazeFace (Apache-2.0, ya presente)** — ambos dan bbox + 5 landmarks para la alineación.
  3. Alternativa: **re-entrenar** SCRFD/ArcFace propios sobre datos con título limpio (GPU del server 34).
- **Acción mínima antes de go-live:** confirmar la procedencia exacta de `recognizer.onnx`. Si proviene de
  glint360k/webface600k de InsightFace → **swap obligatorio**. Validar paridad de embeddings (coseno) del
  reemplazo contra el set de prueba antes del cutover.

### 🔴 R2 — ALTO: OpenSanctions es no-comercial sin licenciar
- **Hecho verificado:** el dataset consolidado de OpenSanctions es **gratis solo para uso no comercial**;
  producción comercial **requiere licencia** (ya flagueado en `docs/specs/aml-screening.md` §Licencia).
- **Mitigación de arquitectura (ya existe):** el provider es **pluggable** (`AmlProvider` + tabla local) →
  se cambia la fuente sin tocar pipeline ni matching.
- **Recomendación:** antes de go-live, **licenciar OpenSanctions** *o* repoblar `aml_entities` desde
  **listas oficiales descargadas directo** (OFAC SDN, UN Consolidated, EU, UK HMT — de uso libre) o un
  vendor on-prem licenciado.

### 🟡 R3 — MEDIO: Template admin "ecme" (licencia comercial, no OSS)
- El admin (`admin/`, paquete `"ecme"`) es un **template comercial** (tipo ThemeForest), **no open source**.
- **Recomendación:** asegurar una **licencia de template válida y suficiente** para el modelo de
  distribución (SaaS / nº de end-products). No redistribuir el código fuente del template. Conservar el
  comprobante de licencia.

### 🟡 R4 — MEDIO: Qualcomm face_attrib_net — model card "license: other"
- El repo `qualcomm/ai-hub-models` es **BSD-3** (comercial-OK), pero la **model card de Hugging Face lista
  `license: other`** y remite al LICENSE del repo + Terms of Use de Qualcomm AI Hub.
- **Recomendación:** confirmar que los **términos de Qualcomm AI Hub** no añaden restricciones de
  redistribución de pesos. Si quedara dudoso, el gate de anteojos es no-crítico y reemplazable
  (clasificador propio o heurística). Riesgo bajo de impacto, pero **verificar** antes de afirmar OK.

### 🟢 OK — sin riesgo comercial (con cumplimiento de avisos)
FairFace (atribución), MiniFASNet/Silent-Face, DocAligner, MediaPipe, PaddleOCR, opencv.js, onnxruntime,
y todas las libs npm de producción (MIT/Apache/BSD). Solo requieren **conservar el aviso** (§2).

---

## 4. Checklist de cumplimiento antes de go-live comercial

- [ ] **R1** Reemplazar pesos SCRFD/ArcFace por permisivos (AuraFace + YuNet/BlazeFace) y validar paridad.
- [ ] **R2** Licenciar OpenSanctions o migrar a listas oficiales/vendor licenciado.
- [ ] **R3** Verificar licencia válida del template ecme para el modelo de distribución.
- [ ] **R4** Confirmar términos Qualcomm AI Hub para face_attrib_net.
- [ ] **§2** Publicar las atribuciones (FairFace + avisos Apache/BSD/MIT) en el producto y este NOTICE.
- [ ] Generar el listado completo de avisos npm (`npx license-checker-rseidelsohn --production`).

---

## 5. Fuentes (licencias verificadas)

- InsightFace — código MIT / pesos non-commercial: https://github.com/deepinsight/insightface (README + Issue #2022)
- AuraFace (alternativa Apache-2.0): https://huggingface.co/fal/AuraFace-v1
- OpenVINO ArcFace ONNX (alternativa Apache-2.0): https://github.com/openvinotoolkit/open_model_zoo
- Silent-Face-Anti-Spoofing (Apache-2.0): https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/LICENSE
- Qualcomm face_attrib_net (model card "other" + repo BSD-3): https://huggingface.co/qualcomm/Facial-Attribute-Detection · https://github.com/qualcomm/ai-hub-models/blob/main/LICENSE
- FairFace (CC BY 4.0): https://github.com/dchen236/FairFace
- DocAligner (Apache-2.0): https://github.com/DocsaidLab/DocAligner
- MediaPipe (Apache-2.0): https://ai.google.dev/edge/mediapipe
- PaddleOCR (Apache-2.0): https://github.com/PaddlePaddle/PaddleOCR
- OpenSanctions (no-comercial / licencia comercial): https://www.opensanctions.org/licensing/
- sharp (Apache-2.0) y @zxing/library (MIT): verificados en `node_modules/*/package.json`
</content>
</invoke>
