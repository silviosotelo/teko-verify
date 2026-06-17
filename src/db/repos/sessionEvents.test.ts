/**
 * Test del seam FAIL-OPEN del registro de session_events (P0 #3).
 *
 * Registrar un evento del timeline NUNCA debe romper el flujo: `recordSafe` traga
 * cualquier excepción del executor (DB caída, etc.) y devuelve null, mientras que
 * `record` (la variante estricta) sí propaga. Se inyecta un executor falso que
 * lanza para no depender de Postgres.
 */
import { describe, it, expect, vi } from "vitest";
import type { Executor } from "../executor";

// El repo importa el `pool`, que resuelve la URL de la DB al cargar el módulo. Como
// el pool conecta LAZY (sólo on-demand), basta una URL dummy para que el módulo
// cargue; el executor inyectado (que lanza) nunca toca el pool real. Se setea ANTES
// del import dinámico para ganarle al chequeo de pool.ts.
process.env.TEKO_DATABASE_URL ||= "postgres://teko:teko@localhost:5432/teko_test";
const { record, recordSafe } = await import("./sessionEvents");

const throwingExec = {
  query: vi.fn(async () => {
    throw new Error("db down");
  }),
} as unknown as Executor;

const input = {
  tenantId: "t1",
  sessionId: "s1",
  type: "consent.accepted",
  ip: "200.1.2.3",
  country: "PY",
};

describe("recordSafe — fail-open", () => {
  it("devuelve null si el executor falla (no lanza)", async () => {
    await expect(recordSafe(input, throwingExec)).resolves.toBeNull();
  });

  it("record (estricto) SÍ propaga el error", async () => {
    await expect(record(input, throwingExec)).rejects.toThrow("db down");
  });
});
