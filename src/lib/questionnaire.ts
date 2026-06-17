/**
 * Questionnaires (P2) — lógica PURA (sin I/O) de validación de:
 *   1. la DEFINICIÓN de un cuestionario (set de preguntas que el admin guarda), y
 *   2. las RESPUESTAS del solicitante contra esa definición.
 *
 * Sin acoplar la capa de datos: testeable en aislamiento. FAIL-CLOSED en ambos
 * sentidos — una pregunta mal formada se descarta y una respuesta inválida (tipo
 * incorrecto, requerida vacía, opción fuera del set) produce un error de validación;
 * nunca se persiste basura ni se acredita una respuesta que no cumple.
 */
import type {
  QuestionnaireAnswers,
  QuestionnaireAnswerValue,
  QuestionnaireQuestion,
  QuestionnaireQuestionType,
} from "../types";

/** Tipos de pregunta soportados (whitelist runtime). */
export const QUESTION_TYPES: readonly QuestionnaireQuestionType[] = [
  "text",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "number",
] as const;

function isQuestionType(x: unknown): x is QuestionnaireQuestionType {
  return typeof x === "string" && (QUESTION_TYPES as readonly string[]).includes(x);
}

/** Error de validación de una respuesta puntual (auditable, legible). */
export interface QuestionnaireAnswerError {
  questionId: string;
  code:
    | "required"
    | "invalid_type"
    | "invalid_option"
    | "unknown_question";
}

export interface QuestionnaireValidationResult {
  ok: boolean;
  errors: QuestionnaireAnswerError[];
  /** Respuestas NORMALIZADAS (coaccionadas al tipo, recortadas) listas para persistir. */
  answers: QuestionnaireAnswers;
}

/**
 * Sanea/valida una DEFINICIÓN de preguntas (lo que el admin envía al crear/editar un
 * questionnaire). Descarta preguntas mal formadas (sin id/label/tipo válido) y
 * normaliza: dedup de ids, options sólo para select/multiselect, required booleano.
 * Devuelve `null` si el resultado quedaría vacío o el input no es un array (→ 400).
 */
export function sanitizeQuestions(raw: unknown): QuestionnaireQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const out: QuestionnaireQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const id = typeof q.id === "string" ? q.id.trim().slice(0, 80) : "";
    const label = typeof q.label === "string" ? q.label.trim().slice(0, 300) : "";
    if (!id || !label || !isQuestionType(q.type)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const type = q.type;
    const question: QuestionnaireQuestion = {
      id,
      label,
      type,
      required: q.required === true,
    };
    if (type === "select" || type === "multiselect") {
      const options = Array.isArray(q.options)
        ? q.options
            .filter((o): o is string => typeof o === "string")
            .map((o) => o.trim().slice(0, 200))
            .filter((o) => o.length > 0)
            .slice(0, 100)
        : [];
      // Un select sin opciones es inválido (no hay nada que elegir) → se descarta.
      if (options.length === 0) continue;
      question.options = options;
    }
    out.push(question);
  }
  return out.length > 0 ? out : null;
}

/** ¿`v` está vacío para fines de "requerida"? (string vacío, array vacío, null/undefined). */
function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Valida y NORMALIZA las respuestas del solicitante contra el set de preguntas.
 * Fail-closed:
 *   - pregunta requerida sin respuesta → error `required`.
 *   - tipo incorrecto (no coaccionable) → error `invalid_type`.
 *   - select/multiselect con opción fuera del set → error `invalid_option`.
 *   - respuesta a un id desconocido → error `unknown_question` (no se persiste).
 * Las respuestas NO requeridas y vacías se omiten del resultado (no se persiste null).
 */
export function validateQuestionnaireAnswers(
  questions: QuestionnaireQuestion[],
  raw: unknown
): QuestionnaireValidationResult {
  const errors: QuestionnaireAnswerError[] = [];
  const answers: QuestionnaireAnswers = {};
  const input: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const known = new Set(questions.map((q) => q.id));

  // 1) Respuestas a preguntas DESCONOCIDAS → fail-closed (no se persisten + error).
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors.push({ questionId: key, code: "unknown_question" });
    }
  }

  // 2) Valida/normaliza cada pregunta declarada.
  for (const q of questions) {
    const value = input[q.id];
    const required = q.required === true;

    if (isEmpty(value)) {
      // checkbox vacío = false; si es requerido, exige true (consentimiento marcado).
      if (q.type === "checkbox") {
        if (required) errors.push({ questionId: q.id, code: "required" });
        continue;
      }
      if (required) errors.push({ questionId: q.id, code: "required" });
      continue; // no requerida + vacía → se omite (no se persiste)
    }

    switch (q.type) {
      case "text": {
        if (typeof value !== "string") {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        answers[q.id] = value.trim().slice(0, 2000);
        break;
      }
      case "number": {
        const n =
          typeof value === "number"
            ? value
            : typeof value === "string" && value.trim() !== ""
              ? Number(value)
              : NaN;
        if (!Number.isFinite(n)) {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        answers[q.id] = n;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        answers[q.id] = value;
        break;
      }
      case "checkbox": {
        if (typeof value !== "boolean") {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        if (required && value !== true) {
          errors.push({ questionId: q.id, code: "required" });
          break;
        }
        answers[q.id] = value;
        break;
      }
      case "select": {
        if (typeof value !== "string") {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        if (!(q.options ?? []).includes(value)) {
          errors.push({ questionId: q.id, code: "invalid_option" });
          break;
        }
        answers[q.id] = value;
        break;
      }
      case "multiselect": {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
          errors.push({ questionId: q.id, code: "invalid_type" });
          break;
        }
        const opts = q.options ?? [];
        const vals = value as string[];
        if (vals.some((v) => !opts.includes(v))) {
          errors.push({ questionId: q.id, code: "invalid_option" });
          break;
        }
        // dedup preservando orden
        answers[q.id] = vals.filter((v, i) => vals.indexOf(v) === i);
        break;
      }
      default: {
        // Tipo no soportado (defensa; sanitizeQuestions ya lo filtra) → invalid_type.
        errors.push({ questionId: q.id, code: "invalid_type" });
      }
    }
  }

  return { ok: errors.length === 0, errors, answers };
}

/** ¿La definición de workflow exige cuestionario? (presente + no deshabilitado). */
export function questionnaireIdFromWorkflow(
  def: { questionnaire?: { questionnaireId?: string; required?: boolean } } | null | undefined
): string | null {
  const q = def?.questionnaire;
  if (!q || typeof q.questionnaireId !== "string" || !q.questionnaireId) return null;
  if (q.required === false) return null;
  return q.questionnaireId;
}

// Re-export para conveniencia de los consumidores del módulo.
export type { QuestionnaireAnswerValue };
