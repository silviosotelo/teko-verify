/**
 * Setup de tests (vitest). Se ejecuta ANTES de importar los archivos de test, así
 * que los módulos que tocan la capa de datos (db/pool) pueden importarse en tests
 * de lógica pura sin reventar por falta de URL. Si el entorno YA define una URL
 * real (CI/servidor con PG), NO se pisa: los tests de integración la siguen usando.
 *
 * El pool de pg NO conecta hasta la primera query; los tests puros usan un Executor
 * mock y nunca tocan la conexión real, por lo que una URL dummy es inocua.
 */
if (!process.env.TEKO_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.TEKO_DATABASE_URL = "postgres://test:test@127.0.0.1:5432/teko_test_noconnect";
}
