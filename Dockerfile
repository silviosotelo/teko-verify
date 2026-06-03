# Teko Verify — servicio Node (motor de caras heredado de v9 + módulos KYC).
# Multi-stage: build TypeScript -> imagen runtime self-contained.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
# Instala todas las deps (incl. dev) para poder compilar con tsc.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime ---
FROM node:22-bookworm-slim
WORKDIR /app

# Solo deps de producción (onnxruntime-node + sharp prebuilts, pg, express, etc.).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App compilada, frontend de captura y modelos ONNX (montados o baked).
COPY --from=build /app/dist ./dist
COPY web/dist ./web/dist
# Los modelos .onnx (SCRFD, recognizer, PAD, glasses) se montan por volumen
# en compose o se copian aquí en un build self-contained:
# COPY models ./models

ENV PORT=4400 \
    DATABASE_URL=postgres://teko:teko@postgres:5432/teko \
    OCR_SIDECAR_URL=http://paddleocr-sidecar:8001 \
    TEKO_DETECTOR_MODEL=/app/models/scrfd_10g_bnkps.onnx \
    TEKO_RECOGNIZER_MODEL=/app/models/recognizer.onnx \
    TEKO_PAD_MODEL=/app/models/pad_minifasnet.onnx \
    TEKO_GLASSES_MODEL=/app/models/face_attrib_net.onnx

EXPOSE 4400
CMD ["node", "dist/server.js"]
