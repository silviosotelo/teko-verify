/**
 * Repositorio de questionnaires + questionnaire_answers (P2).
 *
 * `questionnaires`: set de preguntas custom por tenant (JSONB). Editar las preguntas
 * BUMPEA `version` (auditoría liviana; no se versiona como filas separadas — v1).
 * `questionnaire_answers`: respuestas del solicitante por SESIÓN (1:1, upsert idempotente
 * por (tenant_id, session_id)).
 *
 * Scopeado por tenant. Las respuestas referencian la sesión por FK COMPUESTA
 * (tenant_id, session_id) en DDL (aislamiento cross-tenant a nivel DB).
 */
import { pool } from "../pool";
import type { Executor } from "../executor";
import { iso } from "./mapping";
import type {
  Questionnaire,
  QuestionnaireAnswerRecord,
  QuestionnaireAnswers,
  QuestionnaireQuestion,
} from "../../types";

interface QuestionnaireRow {
  id: string;
  tenant_id: string;
  name: string;
  questions: QuestionnaireQuestion[];
  version: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapQuestionnaire(row: QuestionnaireRow): Questionnaire {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    questions: Array.isArray(row.questions) ? row.questions : [],
    version: row.version,
    active: row.active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

interface AnswersRow {
  id: string;
  tenant_id: string;
  session_id: string;
  questionnaire_id: string | null;
  answers: QuestionnaireAnswers;
  created_at: Date;
  updated_at: Date;
}

function mapAnswers(row: AnswersRow): QuestionnaireAnswerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    questionnaireId: row.questionnaire_id ?? null,
    answers: row.answers ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

// ============================= questionnaires ============================== //

export async function listByTenant(
  tenantId: string,
  exec: Executor = pool
): Promise<Questionnaire[]> {
  const res = await exec.query<QuestionnaireRow>(
    `SELECT * FROM questionnaires WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId]
  );
  return res.rows.map(mapQuestionnaire);
}

export async function getById(
  tenantId: string,
  id: string,
  exec: Executor = pool
): Promise<Questionnaire | null> {
  const res = await exec.query<QuestionnaireRow>(
    "SELECT * FROM questionnaires WHERE id = $1 AND tenant_id = $2",
    [id, tenantId]
  );
  return res.rows[0] ? mapQuestionnaire(res.rows[0]) : null;
}

export async function create(
  input: { tenantId: string; name: string; questions: QuestionnaireQuestion[] },
  exec: Executor = pool
): Promise<Questionnaire> {
  const res = await exec.query<QuestionnaireRow>(
    `INSERT INTO questionnaires (tenant_id, name, questions)
     VALUES ($1, $2, $3::jsonb)
     RETURNING *`,
    [input.tenantId, input.name, JSON.stringify(input.questions)]
  );
  return mapQuestionnaire(res.rows[0]);
}

/**
 * Update parcial. Si se pasan `questions`, se reemplaza el set y se BUMPEA `version`.
 * `name`/`active` se actualizan si vienen. Devuelve la fila o null si no existe.
 */
export async function update(
  tenantId: string,
  id: string,
  patch: { name?: string; questions?: QuestionnaireQuestion[]; active?: boolean },
  exec: Executor = pool
): Promise<Questionnaire | null> {
  const res = await exec.query<QuestionnaireRow>(
    `UPDATE questionnaires SET
       name      = COALESCE($3, name),
       questions = CASE WHEN $4::boolean THEN $5::jsonb ELSE questions END,
       version   = CASE WHEN $4::boolean THEN version + 1 ELSE version END,
       active    = COALESCE($6, active),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [
      id,
      tenantId,
      patch.name ?? null,
      patch.questions !== undefined,
      patch.questions !== undefined ? JSON.stringify(patch.questions) : null,
      patch.active ?? null,
    ]
  );
  return res.rows[0] ? mapQuestionnaire(res.rows[0]) : null;
}

// ============================ questionnaire_answers ======================== //

/**
 * Upsert idempotente de las respuestas de una sesión (UNIQUE tenant_id, session_id):
 * re-enviar pisa la fila previa. Devuelve la fila resultante.
 */
export async function saveAnswers(
  input: {
    tenantId: string;
    sessionId: string;
    questionnaireId: string | null;
    answers: QuestionnaireAnswers;
  },
  exec: Executor = pool
): Promise<QuestionnaireAnswerRecord> {
  const res = await exec.query<AnswersRow>(
    `INSERT INTO questionnaire_answers (tenant_id, session_id, questionnaire_id, answers)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, session_id) DO UPDATE
       SET answers = EXCLUDED.answers,
           questionnaire_id = EXCLUDED.questionnaire_id,
           updated_at = now()
     RETURNING *`,
    [input.tenantId, input.sessionId, input.questionnaireId, JSON.stringify(input.answers)]
  );
  return mapAnswers(res.rows[0]);
}

export async function getAnswers(
  tenantId: string,
  sessionId: string,
  exec: Executor = pool
): Promise<QuestionnaireAnswerRecord | null> {
  const res = await exec.query<AnswersRow>(
    "SELECT * FROM questionnaire_answers WHERE tenant_id = $1 AND session_id = $2",
    [tenantId, sessionId]
  );
  return res.rows[0] ? mapAnswers(res.rows[0]) : null;
}
