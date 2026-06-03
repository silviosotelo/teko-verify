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


@app.get("/health")
def health():
    return {"status": "ok", "ready": _ocr is not None}


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
