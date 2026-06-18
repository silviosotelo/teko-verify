# Age estimation (P2) — modelo, licencia y diseño

Estimación de edad facial del selfie, server-side, on-prem. Señal/score configurable por
workflow (`ageEstimation.required` + `minAge` + `onUnderage: flag|review|reject`).

## 1. Decisión: modelo elegido

**FairFace ResNet-34** (`res34_fair_align_multi_7_20190809.pt`), repo
[dchen236/FairFace](https://github.com/dchen236/FairFace).

- **Licencia: CC BY 4.0** — uso **comercial permitido** con atribución. Verificada en la
  fuente real (README del repo, sección License, línea 72: "License: CC BY 4.0"). El
  dataset FairFace también es CC BY 4.0, así que la cadena de título es limpia.
- **Tamaño:** ResNet-34, ~85 MB en ONNX (corre bien en CPU con onnxruntime-node).
- **Entrada:** 224×224 RGB, normalización ImageNet `((x/255)-mean)/std`
  (mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`), NCHW.
- **Salida:** 18 logits multitarea = `[raza(7), género(2), EDAD(9)]`. Sólo usamos la
  **cabeza de edad** (índices 9..17): softmax sobre 9 buckets
  `[0-2,3-9,10-19,20-29,30-39,40-49,50-59,60-69,70+]`. La edad estimada puntual es el
  **valor esperado** sobre los midpoints `[1,6,15,25,35,45,55,65,75]` (el bucket abierto
  "70+" se ancla en 75, conservador).

### Atribución (obligación CC BY 4.0)
El producto debe acreditar a FairFace. Cita del repo:
> Kärkkäinen, K., & Joo, J. (2021). *FairFace: Face Attribute Dataset for Balanced Race,
> Gender, and Age for Bias Measurement and Mitigation*. WACV 2021.

### Export ONNX (reproducible, en el 34)
`torchvision.models.resnet34(weights=None)` → `fc = nn.Linear(512, 18)` →
`load_state_dict(res34_fair_align_multi_7_20190809.pt)` → `torch.onnx.export(..., opset=12,
dynamo=False)`. Resultado self-hosteado en `/home/soporte/teko/models/age_fairface_res34.onnx`
(volumen montado en `/app/models`). Sin pesos inventados.

### Validación en vivo (selfie real)
Sobre la evidencia de la sesión field-test **986a770c** (titular SOTELO, adulto):
- `crop_selfie.jpg` → bucket **30-39** (p=0.535), **edad esperada ≈ 31.1 años**.
- `selfie.jpg`      → bucket **30-39** (p=0.361), edad esperada ≈ 33.9 años.

Resultado plausible (adulto). Confirma el wiring del export + el slicing de la cabeza de edad.

## 2. Opciones evaluadas (licencia verificada en la fuente)

| Modelo | Licencia (verificada) | Comercial | Veredicto |
|---|---|---|---|
| **FairFace ResNet-34** | **CC BY 4.0** (README) | **Sí** (con atribución) | **ELEGIDO** — único permisivo con pesos reales descargables + export ONNX limpio + dataset también CC BY 4.0 |
| SSR-Net (shamangary) | Apache-2.0 (LICENSE) | Sí | Alternativa tiny (~1 MB), pero pesos derivan de IMDB-WIKI (académico) → procedencia más débil; export vía tf2onnx (TensorFlow) |
| MiVOLO | Apache-2.0 (LICENSE) | Sí | Mejor MAE, pero ~200 MB, ONNX incómodo, pipeline trae YOLOv8 (AGPL) — evitable porque ya tenemos el crop |
| InsightFace genderage (buffalo_l) | Modelos **non-commercial** | **No** | Excluido (research-only) |
| MiVOLO no aplica… deepface Age | Pesos **CC BY-NC** (VGG-Face) | **No** | Excluido (non-commercial) |
| yu4u/age-gender-estimation | Código MIT; **pesos academic-only** | Código sí / pesos no | Excluido (pesos) |
| Levi-Hassner / Adience age_net | **Sin licencia clara** | No | Excluido (incierta) |
| ONNX Model Zoo age_googlenet | Repo Apache-2.0, **pesos sin grant upstream** | Riesgoso | Excluido (procedencia débil) |
| Qualcomm face_attrib_net | BSD-3 | Sí | **No emite edad** (sólo ojos/máscara/anteojos) — inservible para P2 |
| nateraw/vit-age-classifier | **Licencia ausente** | No | Excluido |

> Nota: **UTKFace es non-commercial** — no usar para reentrenar un regresor shippable. Si
> en el futuro se quiere full clean-title propio, reentrenar sobre imágenes FairFace (CC BY 4.0).

## 3. Diseño de la integración

- **Módulo** `src/modules/ageEstimation.ts`: patrón ONNX del proyecto (carga fail-soft en
  `init()`, helpers puros `softmax`/`ageFromLogits`). `run(selfie, engine, {minAge})`:
  detecta el mejor rostro (SCRFD), recorta el bbox **con contexto** (margen 0.4, no el
  ArcFace 112 ajustado — FairFace ve la cabeza completa), resize 224, normaliza ImageNet,
  infiere, deriva `{estimatedAge, range, confidence, buckets, underage, passed}`.
- **Fail-closed:** sin modelo o sin rostro → `passed=false` + `error` (nunca acredita una
  edad). Con `onUnderage:reject`, fail-closed ⇒ rechazo (un menor jamás pasa por un modelo
  ausente).
- **Workflow** (`WorkflowDefinition.ageEstimation`): `required`, `minAge`, `onUnderage`:
  - `flag` (default): sólo persiste el check.
  - `review`: rutea a la cola de revisión humana (`shouldRouteToReview` → `ageUnderage`).
  - `reject`: **rechazo duro** de la sesión (`ageEstimationRejects` en el pipeline; toma
    precedencia sobre verified y sobre el ruteo a revisión).
- **No** lo consume `decision()` (no es parte de la escalera LoA): es señal/score, igual que
  aml/face_search/proof_of_address.
- **Persistencia:** check `age_estimation` (migración 0017 relaja el CHECK del tipo). El
  `detail` JSONB lleva edad + rango + confianza + distribución.
- **Admin:** card "Estimación de edad" en el tab Overview del detalle de sesión (edad, rango,
  confianza, gate minAge, disclaimer de que NO es prueba legal de edad).

## 4. Límites honestos

- `estimatedAge` es un **estimado estadístico**, NO una edad legal/biográfica. El gate
  `minAge` es un **control de riesgo**, no una prueba de mayoría de edad. El error típico de
  FairFace es de varios años; cerca del umbral conviene `onUnderage:review` (ojo humano), no
  `reject` automático.
- El recorte (bbox + margen) **aproxima** el face-chip alineado de dlib (padding 0.25) con
  que se entrenó FairFace; no es bit-exacto. La estimación es robusta a esa variación
  (validado: crop ajustado 31.1 vs selfie completa 33.9, ambos adultos plausibles).
