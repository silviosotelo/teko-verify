/**
 * Repositorio de workflows (P0 #1) — definición versionada de checks/umbrales/
 * revisión, por tenant. Editar = nueva versión (insert con version = max+1).
 * La versión "vigente" de un nombre = la de mayor `version`.
 *
 * Scopeado por tenant. Las sesiones snapshotean la definición usada, así que borrar
 * una versión NO afecta a las sesiones que ya la referencian (FK SET NULL en DDL).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import {
  assuranceFromDefinition,
  defaultWorkflowName,
  defaultWorkflows,
  workflowDefForLoA,
} from "../../lib/workflow";
import type { LoA, Workflow, WorkflowDefinition } from "../../types";

interface WorkflowRow {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  definition: WorkflowDefinition;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    version: row.version,
    definition: row.definition,
    isDefault: row.is_default,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * Siembra los 3 workflows default (default-l1/-l2/-l3) para un tenant si faltan.
 * Idempotente (ON CONFLICT DO NOTHING sobre el índice (tenant,name,version)).
 * Se invoca al crear un tenant y de forma perezosa al listar workflows.
 */
export async function ensureDefaults(
  tenantId: string,
  exec: Executor = pool
): Promise<void> {
  for (const w of defaultWorkflows()) {
    await exec.query(
      `INSERT INTO workflows (tenant_id, name, version, definition, is_default)
       VALUES ($1, $2, 1, $3::jsonb, true)
       ON CONFLICT (tenant_id, name, version) DO NOTHING`,
      [tenantId, w.name, JSON.stringify(w.definition)]
    );
  }
}

/** Lista TODAS las versiones de todos los workflows del tenant (name asc, version desc). */
export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<Workflow[]> {
  const res = await exec.query<WorkflowRow>(
    `SELECT * FROM workflows WHERE tenant_id = $1
     ORDER BY name ASC, version DESC`,
    [tenantId]
  );
  return res.rows.map(mapWorkflow);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<Workflow | null> {
  const res = await exec.query<WorkflowRow>(
    "SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
}

/** Versión VIGENTE (mayor `version`) de un workflow por nombre. */
export async function getCurrentByName(
  tenantId: string,
  name: string,
  exec: Executor = pool
): Promise<Workflow | null> {
  const res = await exec.query<WorkflowRow>(
    `SELECT * FROM workflows WHERE tenant_id = $1 AND name = $2
     ORDER BY version DESC LIMIT 1`,
    [tenantId, name]
  );
  return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
}

/**
 * Crea una nueva VERSIÓN de un workflow (name): version = (max actual)+1, o 1 si es
 * nuevo. Devuelve la fila creada. `isDefault` se conserva si ya existía el nombre.
 */
export async function createVersion(
  input: { tenantId: string; name: string; definition: WorkflowDefinition; isDefault?: boolean },
  exec: Executor = pool
): Promise<Workflow> {
  const maxRes = await exec.query<{ v: number | null }>(
    "SELECT MAX(version) AS v FROM workflows WHERE tenant_id = $1 AND name = $2",
    [input.tenantId, input.name]
  );
  const nextVersion = (maxRes.rows[0]?.v ?? 0) + 1;
  const res = await exec.query<WorkflowRow>(
    `INSERT INTO workflows (tenant_id, name, version, definition, is_default)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [
      input.tenantId,
      input.name,
      nextVersion,
      JSON.stringify(input.definition),
      input.isDefault ?? false,
    ]
  );
  return mapWorkflow(res.rows[0]);
}

/** Resultado de resolver el workflow a snapshotear al crear una sesión. */
export interface ResolvedSessionWorkflow {
  workflowId: string | null;
  workflowVersion: number | null;
  snapshot: WorkflowDefinition;
  /** LoA equivalente derivado de la def — se persiste en assurance_required (compat). */
  assuranceRequired: LoA;
}

/**
 * Resuelve qué workflow snapshotear al crear una sesión:
 *   - `workflowId` explícito → esa versión (debe existir y ser del tenant).
 *   - sin workflowId → el workflow DEFAULT que mapea al `assuranceRequired` pedido
 *     (sembrando los defaults si faltan). Si por algún motivo no existe la fila,
 *     se cae a la definición default por CÓDIGO (compat total, sin workflowId).
 */
export async function resolveForSession(
  tenantId: string,
  opts: { workflowId?: string | null; assuranceRequired: LoA },
  exec: Executor = pool
): Promise<ResolvedSessionWorkflow> {
  if (opts.workflowId) {
    const wf = await getById(tenantId, opts.workflowId, exec);
    if (!wf) throw new Error("workflow_not_found");
    return {
      workflowId: wf.id,
      workflowVersion: wf.version,
      snapshot: wf.definition,
      assuranceRequired: assuranceFromDefinition(wf.definition),
    };
  }
  await ensureDefaults(tenantId, exec);
  const wf = await getCurrentByName(tenantId, defaultWorkflowName(opts.assuranceRequired), exec);
  if (wf) {
    return {
      workflowId: wf.id,
      workflowVersion: wf.version,
      snapshot: wf.definition,
      assuranceRequired: assuranceFromDefinition(wf.definition),
    };
  }
  const def = workflowDefForLoA(opts.assuranceRequired);
  return {
    workflowId: null,
    workflowVersion: null,
    snapshot: def,
    assuranceRequired: assuranceFromDefinition(def),
  };
}
