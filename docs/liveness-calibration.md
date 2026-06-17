# Calibración del umbral de liveness (LIVENESS_THRESHOLD)

**Estado:** ajuste INTERINO basado en datos. **Fecha:** 2026-06-17.
**Cambio:** `LIVENESS_THRESHOLD` 0.70 → **0.60** (env del compose del 34 + default en `src/config.ts`).

## Motivo

Una verificación REAL de un usuario genuino (sesión `5c9b4817`, LoA L3) salió
**rechazada por falso-rechazo del liveness**: document 0.946 ✓, match 0.596 ✓,
quality ✓, **liveness 0.686 ❌ (< 0.70)**. El selfie es una persona viva,
confirmado visualmente. El umbral 0.70 estaba demasiado pegado al piso de los
genuinos.

## Metodología

Se corrió el **ENSEMBLE PAD REAL de producción** (`src/modules/liveness.ts`,
2× MiniFASNet, scales 2.7/4.0, input crudo 0..255, prob "real" = índice 1) sobre
la evidencia almacenada en `/data/evidence`, vía `scripts/score-liveness.cjs`
dentro del contenedor `teko-teko-verify-1`.

### Scores medidos

| Clase | Muestra | Score ensemble |
|---|---|---|
| Genuino (rostro vivo) | sesión 5c9b4817 (la rechazada) | **0.6867** |
| Genuino | b951ecd6 | 0.9995 |
| Genuino | ae5a00b3 | 0.9995 |
| Genuino | ce888179 (selfie) | 0.9995 |
| Genuino | 11bc281d | 0.9965 |
| Genuino | 2265a607 | 0.8992 |
| Genuino | 62be7180 | 0.9883 |
| Genuino | d8a44e88 | 0.9988 |
| Spoof (cédula impresa usada como "selfie") | eb75f53f | 0.1689 |
| Spoof (cédula sobre teclado como "selfie") | d8e79468 | 0.3166 |
| Spoof (doc_front, foto de cédula) | 5c9b4817 | 0.0491 |
| Spoof (doc_front) | de392658 | 0.0000 |
| Spoof (doc_front_raw) | 5c9b4817 | 0.0491 |
| **Outlier** spoof (cédula limpia y completa) | ce888179 (doc_front) | **0.6963** |

> Nota: varios `selfie.jpg` de prueba pesaban 267 bytes (imágenes vacías/corruptas):
> no contienen rostro → el ensemble da 0.0000 (fail-closed por "sin cara"). Se
> excluyeron del análisis; no son selfies genuinas.

## Decisión

- **Piso genuino:** 0.6867.
- **Cúmulo de spoofs realistas:** ≤ 0.3166 (la mayoría < 0.05).
- **Umbral elegido: 0.60.** Pasa todos los genuinos (≥ 0.6867) y rechaza el
  cúmulo de spoofs (≤ 0.3166), con margen a ambos lados.

## Limitación conocida (outlier)

Una **foto de cédula limpia y completa** puntúa **0.6963** — por ENCIMA del piso
genuino (0.6867). Es la debilidad documentada de MiniFASNet: detecta TEXTURA de
pantalla/impresión, y un documento nítido carece de ella. **Ningún** umbral en el
rango (0.60, 0.69) separa ese outlier del genuino sin volver a rechazar al usuario
real. Por eso 0.60 (frenar el falso-rechazo) es la decisión correcta hoy, y el
outlier queda mitigado por las **defensas en capas**:

1. **Gating facial MediaPipe** en la captura de selfie (rostro 35–70% del frame,
   centrado, frontal): una cédula entera sostenida a la cámara tiene un rostro
   diminuto y no pasa el encuadre.
2. **Match 1:1** selfie ↔ foto del documento.
3. **Desafío activo** opcional (giro) que la policy del tenant puede exigir en L3.

## Pendiente

La calibración FINA definitiva requiere un **eval set ETIQUETADO de spoofs reales**
(print/replay/máscara, capturados por el camino real de selfie). Con él se podrá
elegir el umbral por ROC/EER en vez de por los pocos datos disponibles hoy.
