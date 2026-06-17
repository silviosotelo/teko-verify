# Detector ML de documento/ID-card client-side — investigación y decisión (Fase 2)

Fecha: 2026-06-16
Estado actual: detector **geométrico OpenCV.js** en Web Worker (`web/public/docWorker.js`
+ `web/src/docAnalyze.ts` + `web/src/useDocDetector.ts`), contrato `{status, verdict, quad}`.
**FUNCIONA**: rechaza teclado/pared, detecta cédula que llena el marco, valida
relleno/esquinas/proporción/nitidez/brillo/reflejo. Fail-closed.

## TL;DR — DECISIÓN: DIFERIR (no se embarca ML ahora)

**No existe hoy un modelo ML de detección de documento/ID-card que sea, a la vez:
(a) descargable y con pesos reales, (b) licencia usable en un SaaS comercial de KYC,
(c) ≤ ~15 MB para móvil, y (d) confiable/auditado para fail-closed.** Cada camino viable
exige **entrenar** un modelo propio. Embarcar cualquiera de las opciones actuales sería
"algo a medias" (modelo de 85 MB, o pesos sin auditar, o licencia AGPL tóxica). El OpenCV
anda. Se deja como está y se entrega este informe con el plan recomendado.

## Modelos evaluados (reales, verificados)

| Modelo | Origen | Licencia | Tamaño | Salida | Veredicto |
|---|---|---|---|---|---|
| **Unet + ResNet34** (MIDV-500) | github.com/ternaus/midv-500-models | **MIT** ✓ | **~83 MB** fp32 (.pth); ONNX similar, int8 ~25 MB | máscara de segmentación binaria | Pesos MIT reales y descargables, **pero ~6× sobre el budget móvil**; solo da máscara (hay que post-procesar a quad igual que ya hace OpenCV); no trae export ONNX. **Inviable para web móvil por tunnel** (ya sufrimos con opencv.js de 11 MB). |
| **YOLOv8n** (-det / -seg / -pose) | Ultralytics | **AGPL-3.0** ✗ | int8 ONNX ~6 MB, fp32 ~12 MB | bbox / máscara / 4 keypoints (corners) | **Encaja en tamaño y velocidad** (onnxruntime-web WASM-SIMD/WebGPU; int8 2–3× más rápido). Pero **AGPL obliga a abrir el código conectado** → tóxico para SaaS KYC salvo licencia Enterprise de Ultralytics (de pago). Además **no hay pretrained de ID-card confiable**: hay que entrenar en MIDV. |
| **Roboflow Universe "id-card detection"** | varios | variable/incierta | varía | mayormente bbox | Existen, pero **calidad sin auditar y licencias dispares**. Inaceptable para fail-closed KYC sin auditoría. |
| **MediaPipe / ML Kit** | Google | — | — | — | **No hay** modelo dedicado de documento/ID-card para web on-prem. Object Detector es EfficientDet-Lite genérico; ML Kit Document Scanner es **Android cerrado**, no self-host web. |
| **RF-DETR** (Mar 2025) / **PP-YOLO** | Roboflow / PaddlePaddle | **Apache-2.0** ✓ | más pesados; no hay nano browser-ready | bbox/seg | Licencia permisiva y buena precisión, pero **no optimizados a ≤15 MB nano** para navegador y **igual requieren entrenar** en ID-cards. Candidatos de backbone si se hace el entrenamiento propio. |

### Por qué ML no es "gratis" aquí
Un detector ML de **bbox** solo dice "hay una tarjeta" — **no da las 4 esquinas** (quad) ni
mide nitidez/reflejo/relleno. Para el contrato actual harían falta **-pose (keypoints=corners)
o -seg (máscara → contorno → approxPolyDP)** y, encima, **conservar el gating geométrico**
(nitidez/glare/fill/aspect) como post-filtro. O sea: el ML reemplaza solo el paso "¿hay
tarjeta y dónde están sus esquinas?", de forma más robusta en fondos de bajo contraste; no
reemplaza el pipeline entero. El upside real es robustez de negativos y de cédulas sin bordes
limpios — no arregla nada roto (OpenCV ya rechaza teclado/pared).

## Plan recomendado (cuando se decida invertir el entrenamiento)

1. **Modelo**: entrenar **YOLOv8n-pose con 4 keypoints (las esquinas)** — el quad sale
   directo y mapea 1:1 al contrato. Alternativa **sin AGPL**: **U-Net con backbone
   MobileNetV3-small** (o nano-seg permisivo) entrenado desde cero → sin restricción de
   licencia. Cuantizar a **int8 → ONNX ~3–6 MB**.
2. **Datos**: MIDV-500 + MIDV-2020 + **muestras reales de cédula paraguaya** (las que ya
   tenemos en captura). Augment de perspectiva/iluminación/reflejo.
3. **Licencia**: para evitar AGPL → o **U-Net propio** (limpio), o **Ultralytics Enterprise**,
   o RF-DETR/PP-YOLO Apache como backbone. Decidir antes de entrenar.
4. **Runtime**: `onnxruntime-web` (ya hay precedente MediaPipe en `web/public/mediapipe/`).
   Worker **clásico** clonando el patrón de `docWorker.js` (mismo protocolo init/frame/result,
   back-pressure de 1 frame en vuelo, `.onnx` self-hosted same-origin bajo `/app/`).
5. **Salida → contrato**: keypoints→quad (o máscara→contorno→quad), y **mantener el gating
   geométrico actual** (`analyze`) como post-filtro de nitidez/brillo/reflejo/relleno/aspect.
   Mismo `{status, verdict, quad}`.
6. **Integración**: detrás de flag **`?detector=ml`** con **fallback a OpenCV** (y timeout de
   arranque como el actual `READY_TIMEOUT_MS`). Nunca degradar la captura manual.
7. **Verificación**: set fijo de frames — cédula real (`good`), teclado/pared (`no-doc`),
   parcial/torcido (coaching) — reusando el patrón `classifyFrame` headless.

### Costo/esfuerzo estimado
- Recolectar/etiquetar corners (MIDV ya viene etiquetado; cédula PY a etiquetar): ~1–2 días.
- Entrenar + cuantizar + exportar ONNX + validar mAP/IoU: ~1–2 días GPU (el server 34 tiene
  RTX 5060).
- Worker onnxruntime-web + mapeo al contrato + flag/fallback + verificación: ~1–2 días.
- Total ~1 semana de ingeniería + decisión de licencia. Riesgo bajo (fallback OpenCV siempre).

## Recomendación final
**Diferir.** Mantener OpenCV (que anda). Cuando haya budget para el entrenamiento, ejecutar el
plan de arriba (YOLOv8n-pose con licencia resuelta, o U-Net MobileNetV3 sin AGPL) detrás de
`?detector=ml` con fallback. No embarcar ahora ningún modelo de 85 MB, AGPL, ni Roboflow sin
auditar — sería romper el fail-closed o la UX móvil.

## Fuentes
- ternaus/midv-500-models (Unet+ResNet34, MIT): https://github.com/ternaus/midv-500-models
- Train YOLO seg con MIDV-500: https://dev.to/yushulx/how-to-train-a-yolo-segmentation-model-with-midv500-dataset-for-id-document-detection-25m5
- ID docs detection YOLOv8 + orientación: https://github.com/orgs/ultralytics/discussions/13469
- Licencias YOLO (AGPL vs Enterprise; RF-DETR/PP-YOLO permisivos): https://medium.com/@bingbai.jp/yolo-model-licenses-a-developers-guide-da722767b6f8 · https://roboflow.com/model-licenses/yolov8
- onnxruntime-web (YOLO en navegador, WASM/WebGPU): https://github.com/nomi30701/yolo-object-detection-onnxruntime-web · https://pyimagesearch.com/2025/07/28/run-yolo-model-in-the-browser-with-onnx-webassembly-and-next-js/
