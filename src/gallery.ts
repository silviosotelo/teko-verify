/**
 * v9 gallery — PostgreSQL storage + in-memory brute-force cosine matching
 * (port of v8's proven approach). All embeddings are L2-normed, so cosine = dot.
 *
 * DEAD CODE EN TEKO VERIFY (conservado a propósito).
 * Teko Verify hace match 1:1 (selfie <-> foto del documento), NO 1:N. El
 * matcher por fuerza bruta de v9 no se usa: el módulo match.ts (src/modules)
 * compara dos embeddings con MATCH_THRESHOLD (config.ts). Este archivo se
 * mantiene únicamente porque el server.ts heredado aún lo importa y para no
 * romper la compilación; será eliminado cuando se reescriba server.ts en la
 * fase de módulos. Si más adelante se necesita dedup 1:N sobre datos propios
 * de Teko (spec §13), este es el punto de partida.
 */
import { Pool } from "pg";
import * as cfg from "./config";

export interface PersonRow {
  id: number;
  name: string;
  count: number;
}

export class Gallery {
  private pool: Pool;
  private ciList: string[] = [];
  private names: Map<string, string> = new Map();
  private matrix: Float32Array | null = null; // N * dim, row-major
  private dim = cfg.REC.embeddingDim;
  private rows = 0;

  constructor() {
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 8 });
  }

  async initTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${cfg.TABLE} (
        id          serial PRIMARY KEY,
        ci          text NOT NULL,
        name        text,
        embedding   text NOT NULL,
        created_at  timestamptz DEFAULT now()
      )`);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_${cfg.TABLE}_ci ON ${cfg.TABLE} (ci)`
    );
  }

  async load(): Promise<void> {
    const res = await this.pool.query(
      `SELECT ci, name, embedding FROM ${cfg.TABLE} ORDER BY id`
    );
    const ciList: string[] = [];
    const names = new Map<string, string>();
    const vecs: number[][] = [];
    for (const row of res.rows) {
      let vec: number[];
      try {
        vec = JSON.parse(row.embedding);
      } catch {
        continue;
      }
      if (!Array.isArray(vec) || vec.length !== this.dim) continue;
      ciList.push(row.ci);
      names.set(row.ci, row.name || row.ci);
      vecs.push(vec);
    }
    const matrix = new Float32Array(vecs.length * this.dim);
    for (let i = 0; i < vecs.length; i++) {
      matrix.set(vecs[i], i * this.dim);
    }
    this.ciList = ciList;
    this.names = names;
    this.matrix = vecs.length ? matrix : null;
    this.rows = vecs.length;
  }

  /** Brute-force cosine over the in-memory matrix. */
  match(query: Float32Array): { ci: string | null; name: string | null; sim: number } {
    if (!this.matrix || this.rows === 0) return { ci: null, name: null, sim: 0 };
    const dim = this.dim;
    let bestIdx = 0;
    let bestSim = -1;
    for (let r = 0; r < this.rows; r++) {
      const off = r * dim;
      let dot = 0;
      for (let k = 0; k < dim; k++) dot += this.matrix[off + k] * query[k];
      if (dot > bestSim) {
        bestSim = dot;
        bestIdx = r;
      }
    }
    if (bestSim >= cfg.SIM_THRESHOLD) {
      const ci = this.ciList[bestIdx];
      return { ci, name: this.names.get(ci) || ci, sim: bestSim };
    }
    return { ci: null, name: null, sim: bestSim };
  }

  async insert(ci: string, name: string, embedding: Float32Array): Promise<void> {
    const json = JSON.stringify(Array.from(embedding));
    await this.pool.query(
      `INSERT INTO ${cfg.TABLE} (ci, name, embedding) VALUES ($1, $2, $3)`,
      [ci, name, json]
    );
  }

  /** Replace all embeddings of a CI with one (update semantics). */
  async replace(ci: string, name: string, embedding: Float32Array): Promise<void> {
    const json = JSON.stringify(Array.from(embedding));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ${cfg.TABLE} WHERE ci = $1`, [ci]);
      await client.query(
        `INSERT INTO ${cfg.TABLE} (ci, name, embedding) VALUES ($1, $2, $3)`,
        [ci, name, json]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteByCi(ci: string): Promise<number> {
    const res = await this.pool.query(`DELETE FROM ${cfg.TABLE} WHERE ci = $1`, [
      ci,
    ]);
    return res.rowCount || 0;
  }

  async deleteById(id: number): Promise<number> {
    const res = await this.pool.query(`DELETE FROM ${cfg.TABLE} WHERE id = $1`, [
      id,
    ]);
    return res.rowCount || 0;
  }

  async personRow(ci: string): Promise<PersonRow | null> {
    const res = await this.pool.query(
      `SELECT min(id) AS id, max(name) AS name, count(*) AS n FROM ${cfg.TABLE} WHERE ci = $1`,
      [ci]
    );
    const row = res.rows[0];
    if (!row || row.id === null) return null;
    return { id: Number(row.id), name: row.name, count: Number(row.n) };
  }

  async persons(): Promise<Array<{ ci: string; name: string; embeddings: number }>> {
    const res = await this.pool.query(
      `SELECT ci, max(name) AS name, count(*) AS n FROM ${cfg.TABLE} GROUP BY ci ORDER BY ci`
    );
    return res.rows.map((r) => ({
      ci: r.ci,
      name: r.name,
      embeddings: Number(r.n),
    }));
  }

  stats() {
    return {
      total_embeddings: this.rows,
      distinct_ci: new Set(this.ciList).size,
      embedding_dim: this.dim,
    };
  }

  get size() {
    return this.rows;
  }
}

export const gallery = new Gallery();
