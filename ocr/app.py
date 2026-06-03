"""
Teko Verify — sidecar OCR (PaddleOCR 3.x / PP-OCRv5).

Servicio Python aislado que expone POST /ocr para que el modulo document.ts
extraiga texto del frente de la cedula PY con mejor precision que un OCR en
Node. 100% on-prem: PaddleOCR corre local, no llama a ningun servicio externo.

Contrato (estable, igual que la version 2.x):
  POST /ocr   (multipart/form-data, campo "image")  -> { "lines": [ {text, score, box} ], "text": "..." }
  GET  /health                                       -> { "status": "ok", "ready": bool }
"""
from __future__ import annotations

import io

from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="teko-verify-ocr", version="0.2.0")

# Lazy init: PaddleOCR carga sus modelos (PP-OCRv5) en el primer uso (arranque
# mas rapido, y /health responde aunque los pesos todavia no esten cargados).
_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR  # import diferido

        # PaddleOCR 3.x: 'use_angle_cls'/'show_log' ya no existen. Para la cedula
        # (foto suelta, no escaneo) desactivamos orientacion/unwarp de documento
        # y dejamos solo la orientacion de linea de texto. lang="es" -> modelo latino.
        _ocr = PaddleOCR(
            lang="es",
            use_textline_orientation=True,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
        )
    return _ocr


def _extract(res):
    """Normaliza un resultado de PaddleOCR 3.x a lineas {text, score, box}."""
    # En 3.x, predict() devuelve objetos Result; los datos viven en .json
    # (a veces envueltos en {"res": {...}}) o son accesibles como dict.
    data = None
    j = getattr(res, "json", None)
    if isinstance(j, dict):
        data = j.get("res", j)
    elif isinstance(res, dict):
        data = res.get("res", res)
    if not isinstance(data, dict):
        return []
    texts = data.get("rec_texts") or []
    scores = data.get("rec_scores") or []
    polys = data.get("rec_polys")
    if polys is None:
        polys = data.get("dt_polys") or []
    out = []
    for i, text in enumerate(texts):
        score = float(scores[i]) if i < len(scores) else 0.0
        box = polys[i] if i < len(polys) else []
        try:
            box = [[float(x), float(y)] for x, y in box]
        except Exception:  # noqa: BLE001
            box = []
        out.append({"text": str(text), "score": score, "box": box})
    return out


@app.get("/health")
def health():
    return {"status": "ok", "ready": _ocr is not None}


@app.post("/ocr")
async def ocr(image: UploadFile = File(...)):
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty image")

    import numpy as np
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid image: {exc}") from exc

    arr = np.array(img)
    results = _get_ocr().predict(arr)

    lines = []
    for res in results or []:
        lines.extend(_extract(res))

    return {"lines": lines, "text": "\n".join(l["text"] for l in lines)}
