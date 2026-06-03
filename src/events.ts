/**
 * v9 audit/history events: persists each enroll/recognize (with its photo) for the
 * dashboard. Images go to disk (V9_EVENTS_DIR — a CIFS-mounted share), the row
 * (metadata) goes to PostgreSQL (v9_events). Recording is fire-and-forget so it
 * never adds latency to the totem response.
 */
import { Pool } from "pg";
import sharp from "sharp";
import { promises as fsp } from "fs";
import path from "path";
import { EventEmitter } from "events";
import * as cfg from "./config";

const EVENTS_DIR = process.env.V9_EVENTS_DIR || "/data/events";
// archivos-locales serves from the share root; the daily pipeline relocates files
// from tmp/produccion to <YYYY>/<MM>/<DD>/produccion/<CATEGORY>/.
const ARCHIVOS_BASE = (process.env.V9_ARCHIVOS_BASE || "http://archivos-locales.santaclara.com.py").replace(/\/+$/, "");
const ARCHIVOS_TZ = process.env.V9_ARCHIVOS_TZ || "America/Asuncion";

export interface EventInput {
  kind: "recognize" | "enroll" | "update" | "delete";
  ci?: string | null;
  name?: string | null;
  similarity?: number | null;
  success?: boolean | null;
  source?: string | null; // 'totem' (compat/ORDS) | 'web' (v9app)
  error?: string | null;
}

export class Events {
  private pool: Pool;
  private emitter = new EventEmitter();
  constructor() {
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 4 });
    this.emitter.setMaxListeners(0); // many SSE subscribers
  }

  /** Subscribe to live events (SSE). Returns an unsubscribe fn. */
  onEvent(fn: (row: any) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }

  async initTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS v9_events (
        id          serial PRIMARY KEY,
        ts          timestamptz DEFAULT now(),
        kind        text NOT NULL,
        ci          text,
        name        text,
        similarity  real,
        success     boolean,
        source      text,
        error       text,
        image_file  text
      )`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_v9_events_ts ON v9_events (ts DESC)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_v9_events_ci ON v9_events (ci)`);
    try {
      await fsp.mkdir(EVENTS_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  /** Fire-and-forget: save image (if any) + insert row. Never throws to the caller. */
  record(ev: EventInput, imageBuf?: Buffer): void {
    this._record(ev, imageBuf).catch((e) =>
      // eslint-disable-next-line no-console
      console.error("[events] record failed:", e?.message || e)
    );
  }

  private async _record(ev: EventInput, imageBuf?: Buffer): Promise<void> {
    let imageFile: string | null = null;
    if (imageBuf && imageBuf.length) {
      try {
        // Write FLAT into the share root — a crontab on 192.168.41.158 (also the
        // 'archivos-locales' host) reorganizes files into date folders afterward.
        const now = new Date();
        const safeCi = (ev.ci || "noface").replace(/[^\w-]/g, "");
        const rel = `${now.getTime()}_${ev.kind}_${safeCi}.jpg`;
        const jpg = await sharp(imageBuf)
          .resize(640, 640, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        await fsp.writeFile(path.join(EVENTS_DIR, rel), jpg);
        imageFile = rel;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[events] image save failed:", e?.message || e);
      }
    }
    const ins = await this.pool.query(
      `INSERT INTO v9_events (kind, ci, name, similarity, success, source, error, image_file)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, ts`,
      [
        ev.kind,
        ev.ci ?? null,
        ev.name ?? null,
        ev.similarity ?? null,
        ev.success ?? null,
        ev.source ?? null,
        ev.error ?? null,
        imageFile,
      ]
    );
    // Push to live SSE subscribers (same shape as list() rows).
    const r = ins.rows[0];
    this.emitter.emit("event", {
      id: r.id,
      ts: r.ts,
      kind: ev.kind,
      ci: ev.ci ?? null,
      name: ev.name ?? null,
      similarity: ev.similarity ?? null,
      success: ev.success ?? null,
      source: ev.source ?? null,
      error: ev.error ?? null,
      has_image: imageFile !== null,
    });
  }

  async list(opts: {
    kind?: string;
    ci?: string;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; limit: number; offset: number; rows: any[] }> {
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (opts.kind) {
      where.push(`kind = $${i++}`);
      params.push(opts.kind);
    }
    if (opts.ci) {
      where.push(`ci ILIKE $${i++}`);
      params.push(`%${opts.ci}%`);
    }
    if (opts.success != null) {
      where.push(`success = $${i++}`);
      params.push(opts.success);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    const rows = (
      await this.pool.query(
        `SELECT id, ts, kind, ci, name, similarity, success, source, error,
                (image_file IS NOT NULL) AS has_image
         FROM v9_events ${w} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`,
        params
      )
    ).rows;
    const total = Number(
      (await this.pool.query(`SELECT count(*) c FROM v9_events ${w}`, params)).rows[0].c
    );
    return { total, limit, offset, rows };
  }

  /**
   * Resolve an event's image: while it is still in the local mount (before the
   * pipeline relocates it) serve the file; once moved, redirect to its
   * archivos-locales dated URL (YYYY/MM/DD from the event's date, PY timezone).
   */
  async resolveImage(
    id: number
  ): Promise<{ type: "local"; path: string } | { type: "remote"; url: string } | null> {
    const r = await this.pool.query(`SELECT ts, image_file FROM v9_events WHERE id = $1`, [id]);
    const row = r.rows[0];
    const file: string | null = row?.image_file || null;
    if (!file || file.includes("..")) return null;

    const local = path.join(EVENTS_DIR, file);
    try {
      await fsp.access(local);
      return { type: "local", path: local };
    } catch {
      /* moved by the pipeline → build the archivos-locales dated URL */
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: ARCHIVOS_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(row.ts));
    const y = parts.find((p) => p.type === "year")!.value;
    const m = parts.find((p) => p.type === "month")!.value;
    const d = parts.find((p) => p.type === "day")!.value;
    return {
      type: "remote",
      url: `${ARCHIVOS_BASE}/${y}/${m}/${d}/produccion/RECONOCIMIENTO_FACIAL/${file}`,
    };
  }

  async stats(): Promise<any> {
    const r = await this.pool.query(`
      SELECT
        count(*) FILTER (WHERE kind='recognize') AS recognies,
        count(*) FILTER (WHERE kind='recognize' AND success) AS recon_ok,
        count(*) FILTER (WHERE kind='enroll') AS enrolls,
        count(*) AS total
      FROM v9_events`);
    return r.rows[0];
  }
}

export const events = new Events();
