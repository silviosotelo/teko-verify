/**
 * Contrato mínimo de ejecución de queries que satisfacen estructuralmente tanto
 * `Pool` como `PoolClient` (pg).
 *
 * Por qué una interfaz de una sola firma y NO `Pick<PoolClient,"query"> | typeof pool`:
 * el método `query` de pg está SOBRECARGADO; llamar `.query<Row>()` sobre una unión
 * de tipos con métodos sobrecargados puede hacer fallar la resolución de overloads
 * ("No overload matches this call"). Una interfaz con una única firma genérica
 * elimina esa ambigüedad y la comparten pool y client por estructura.
 *
 * Permite que cada repo opere indistintamente con el pool (one-shot) o con un
 * PoolClient dentro de withTransaction (persistencia atómica del pipeline, §6.5).
 */
import type { QueryResult, QueryResultRow } from "pg";

export interface Executor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
}
