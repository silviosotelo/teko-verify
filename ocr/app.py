"""
Teko Verify — sidecar OCR (PaddleOCR).

Servicio Python aislado que expone POST /ocr para que el modulo document.ts
extraiga texto del frente de la cedula PY con mejor precision que un OCR en
Node. 100% on-prem: PaddleOCR corre local, no llama a ningun servicio externo.

Contrato:
  POST /ocr   (multipart/form-data, campo "image")  -> { "lines": [ {text, score, box} ], "text": "..." }
  GET  /health                                       -> { "status": "ok", "ready": bool }
"""
from __future__ import annotations

import io

from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="teko-verify-ocr", version="0.1.0")

# Lazy init: PaddleOCR carga sus modelos en el primer uso (arranque mas rapido,
# y /health responde aunque los pesos todavia no esten cargados).
_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR  # import diferido

        # Cedula PY: latino, idioma español. use_angle_cls corrige rotaciones.
        _ocr = PaddleOCR(use_angle_cls=True, lang="es", show_log=False)
    return _ocr


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
    result = _get_ocr().ocr(arr, cls=True)

    lines = []
    # PaddleOCR devuelve [ [ [box, (text, score)], ... ] ] (una entrada por pagina).
    for page in result or []:
        for box, (text, score) in page or []:
            lines.append(
                {"text": text, "score": float(score), "box": [[float(x), float(y)] for x, y in box]}
            )

    return {"lines": lines, "text": "\n".join(l["text"] for l in lines)}
