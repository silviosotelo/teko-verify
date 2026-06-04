"""
Teko Verify — sidecar OCR (PaddleOCR 3.x / PP-OCRv5).

Servicio Python aislado que expone POST /ocr para que el modulo document.ts
extraiga texto del frente/dorso de la cedula PY. 100% on-prem.

Contrato (alineado con PaddleOcrClient en document.ts):
  POST /ocr   JSON { "image": "<base64>" (crudo o data URL) }
              -> { "text": "linea1\\nlinea2...", "confidence": <0..1>, "lines": [ {text, score} ] }
  GET  /health -> { "status": "ok", "ready": bool }
"""
from __future__ import annotations

import base64
import io

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="teko-verify-ocr", version="0.3.0")

_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR  # import diferido (carga modelos en 1er uso)

        _ocr = PaddleOCR(
            lang="es",
            use_textline_orientation=True,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
        )
    return _ocr


def _extract(res):
    """Normaliza un resultado de PaddleOCR 3.x a (texts, scores)."""
    data = None
    j = getattr(res, "json", None)
    if isinstance(j, dict):
        data = j.get("res", j)
    elif isinstance(res, dict):
        data = res.get("res", res)
    if not isinstance(data, dict):
        return [], []
    texts = data.get("rec_texts") or []
    scores = data.get("rec_scores") or []
    polys = data.get("rec_polys")
    if polys is None:
        polys = data.get("dt_polys") or []
    return list(texts), list(scores), list(polys)


class OcrIn(BaseModel):
    image: str  # base64 (crudo o data URL)


class DocCropIn(BaseModel):
    image: str  # base64 (crudo o data URL)


@app.get("/health")
def health():
    return {"status": "ok", "ready": _ocr is not None}


def _decode_b64_image(raw: str):
    """base64/data-URL -> ndarray BGR (OpenCV). Lanza HTTPException si es invalida."""
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc
    if not blob:
        raise HTTPException(status_code=400, detail="empty image")
    import cv2
    import numpy as np

    arr = np.frombuffer(blob, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="invalid image")
    return img


def _order_quad(pts):
    """Ordena 4 puntos a [top-left, top-right, bottom-right, bottom-left]."""
    import numpy as np

    pts = pts.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)
    return np.array(
        [
            pts[np.argmin(s)],  # TL: menor x+y
            pts[np.argmin(d)],  # TR: menor y-x
            pts[np.argmax(s)],  # BR: mayor x+y
            pts[np.argmax(d)],  # BL: mayor y-x
        ],
        dtype="float32",
    )


def _find_doc_quad(img):
    """Detecta el mayor cuadrilatero de 4 vertices (borde del carnet). None si no hay."""
    import cv2

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    # Dilata para cerrar bordes discontinuos del marco del documento.
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    img_area = float(w * h)
    best = None
    best_area = 0.0
    for c in contours:
        area = cv2.contourArea(c)
        # El documento debe ocupar una fraccion razonable del frame (>=20%).
        if area < img_area * 0.20:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx) and area > best_area:
            best = approx
            best_area = area
    return best


@app.post("/doc-crop")
def doc_crop(inp: DocCropIn):
    """
    Recorta/endereza el documento a su BORDE (warpPerspective sobre el mayor quad de
    4 vertices). FAIL-OPEN: si no hay quad o cualquier error, devuelve la imagen
    original (re-codificada a JPEG). Contrato:
      POST /doc-crop  { "image": "<base64>" }
        -> { "image": "<base64 JPEG>", "cropped": bool }
    """
    img = _decode_b64_image(inp.image or "")
    import cv2
    import numpy as np

    cropped = False
    out_img = img
    try:
        quad = _find_doc_quad(img)
        if quad is not None:
            src = _order_quad(quad)
            (tl, tr, br, bl) = src
            wA = np.linalg.norm(br - bl)
            wB = np.linalg.norm(tr - tl)
            hA = np.linalg.norm(tr - br)
            hB = np.linalg.norm(tl - bl)
            out_w = int(max(wA, wB))
            out_h = int(max(hA, hB))
            if out_w >= 40 and out_h >= 40:
                dst = np.array(
                    [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
                    dtype="float32",
                )
                M = cv2.getPerspectiveTransform(src, dst)
                out_img = cv2.warpPerspective(img, M, (out_w, out_h))
                cropped = True
    except Exception:  # noqa: BLE001  — fail-open: cualquier fallo => original
        out_img = img
        cropped = False

    ok, enc = cv2.imencode(".jpg", out_img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        raise HTTPException(status_code=500, detail="jpeg encode failed")
    return {"image": base64.b64encode(enc.tobytes()).decode("ascii"), "cropped": cropped}


def _ocr_array(arr):
    """Corre PaddleOCR sobre un ndarray (HxWx3 BGR/RGB) y normaliza a la salida del
    contrato. ÚNICA fuente de verdad usada por /ocr y /ocr-enhanced para que el
    shape {text,confidence,lines:[{text,score,box}]} sea idéntico."""
    results = _get_ocr().predict(arr)

    texts, scores, polys = [], [], []
    for res in results or []:
        t, s, p = _extract(res)
        texts.extend(t)
        scores.extend(s)
        polys.extend(p)

    def _box(poly):
        try:
            return [[float(x), float(y)] for x, y in poly]
        except Exception:  # noqa: BLE001
            return []

    conf = float(sum(scores) / len(scores)) if scores else 0.0
    lines = []
    for i, t in enumerate(texts):
        s = float(scores[i]) if i < len(scores) else 0.0
        box = _box(polys[i]) if i < len(polys) else []
        lines.append({"text": str(t), "score": s, "box": box})
    return {"text": "\n".join(str(t) for t in texts), "confidence": conf, "lines": lines}


@app.post("/ocr")
def ocr(inp: OcrIn):
    raw = inp.image or ""
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc
    if not blob:
        raise HTTPException(status_code=400, detail="empty image")

    import numpy as np
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(blob)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

    arr = np.array(img)
    return _ocr_array(arr)


@app.post("/ocr-enhanced")
def ocr_enhanced(inp: OcrIn):
    """
    OCR con PRE-PROCESO para texto sobre FONDO DE SEGURIDAD (watermark "REPÚBLICA
    DEL PARAGUAY" + sello rojo + guilloché rosa del frente de la cédula PY, que
    GARBLA la mitad superior en /ocr crudo). Receta validada sobre la imagen real:
      canal VERDE (debilita el naranja/rosa/rojo de seguridad, conserva el texto
      negro) -> GaussianBlur 3x3 -> adaptiveThreshold Gaussiano (blockSize=25, C=9).
    PRESERVA la geometría W×H del frente (NO doc-crop): el anclaje etiqueta→valor de
    document.ts usa píxeles ABSOLUTOS, así que la imagen binarizada debe mantener el
    mismo tamaño que el crudo. Mismo contrato/shape que /ocr.

    NOTA DE SEGURIDAD: este endpoint puede MEZCLAR texto del watermark en la caja del
    valor (visto real: apellido "ORUE SOSA" + bleed "A DEL" => "ORUE SOSAA DEL" en una
    SOLA caja). La defensa vive en document.ts (`looksLikeName` rechaza un nombre cuyo
    último token es una partícula de fondo: DEL/DE/LA/...): este endpoint NO sanea, sólo
    re-OCR-ea. El tier enhanced es fill-blanks-only y gated en campos requeridos faltantes.
    """
    raw = inp.image or ""
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid base64: {exc}") from exc
    if not blob:
        raise HTTPException(status_code=400, detail="empty image")

    import cv2
    import numpy as np

    arr = np.frombuffer(blob, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # BGR, geometría nativa
    if img is None:
        raise HTTPException(status_code=400, detail="invalid image")

    b, g, r = cv2.split(img)  # canal VERDE = g
    blurred = cv2.GaussianBlur(g, (3, 3), 0)
    binar = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 9
    )
    # PaddleOCR.predict espera 3 canales; apilamos sin recortar => W×H preservado.
    bgr = cv2.cvtColor(binar, cv2.COLOR_GRAY2BGR)
    return _ocr_array(bgr)
