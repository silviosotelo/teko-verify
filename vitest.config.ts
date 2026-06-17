import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Provee una URL de DB dummy si el entorno no define una real (tests de lógica
    // pura con Executor mock). No afecta a entornos con PG real (no se pisa).
    setupFiles: ["./vitest.setup.ts"],
  },
});
