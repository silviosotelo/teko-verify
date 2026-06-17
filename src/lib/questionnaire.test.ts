/**
 * Tests de la lógica PURA de questionnaires (P2):
 *   - sanitizeQuestions: descarte de preguntas mal formadas / opciones / dedup.
 *   - validateQuestionnaireAnswers: requeridas, tipos, opciones, ids desconocidos,
 *     normalización (coerción number/string, dedup multiselect) — fail-closed.
 *   - questionnaireIdFromWorkflow: gating de la def del workflow.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeQuestions,
  validateQuestionnaireAnswers,
  questionnaireIdFromWorkflow,
} from "./questionnaire";
import type { QuestionnaireQuestion } from "../types";

describe("sanitizeQuestions", () => {
  it("descarta preguntas sin id/label/tipo válido y deduplica ids", () => {
    const out = sanitizeQuestions([
      { id: "a", label: "A", type: "text", required: true },
      { id: "", label: "no id", type: "text" },
      { id: "b", label: "no type", type: "frobnicate" },
      { id: "a", label: "dup", type: "text" }, // dup id → descartada
      { id: "c", label: "Sel", type: "select", options: ["x", "y", ""] },
      { id: "d", label: "Sel sin opciones", type: "select", options: [] }, // → descartada
    ]);
    expect(out).not.toBeNull();
    expect(out!.map((q) => q.id)).toEqual(["a", "c"]);
    const sel = out!.find((q) => q.id === "c")!;
    expect(sel.options).toEqual(["x", "y"]); // opción vacía filtrada
    expect(out!.find((q) => q.id === "a")!.required).toBe(true);
  });

  it("devuelve null si no hay ninguna pregunta válida o no es array", () => {
    expect(sanitizeQuestions([])).toBeNull();
    expect(sanitizeQuestions([{ foo: "bar" }])).toBeNull();
    expect(sanitizeQuestions("nope" as unknown)).toBeNull();
  });
});

const QUESTIONS: QuestionnaireQuestion[] = [
  { id: "fullname", label: "Nombre", type: "text", required: true },
  { id: "age", label: "Edad", type: "number", required: true },
  { id: "country", label: "País", type: "select", options: ["PY", "AR"], required: true },
  { id: "langs", label: "Idiomas", type: "multiselect", options: ["es", "en", "pt"] },
  { id: "terms", label: "Acepto", type: "checkbox", required: true },
  { id: "dob", label: "Nacimiento", type: "date" },
  { id: "notes", label: "Notas", type: "text" },
];

describe("validateQuestionnaireAnswers", () => {
  it("acepta y normaliza respuestas válidas", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, {
      fullname: "  Ada  ",
      age: "30", // string numérico → coaccionado a number
      country: "PY",
      langs: ["es", "en", "es"], // dedup
      terms: true,
      dob: "1990-05-01",
      // notes omitida (no requerida)
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.answers.fullname).toBe("Ada");
    expect(r.answers.age).toBe(30);
    expect(r.answers.country).toBe("PY");
    expect(r.answers.langs).toEqual(["es", "en"]);
    expect(r.answers.terms).toBe(true);
    expect(r.answers.dob).toBe("1990-05-01");
    expect("notes" in r.answers).toBe(false);
  });

  it("falla por requeridas faltantes (incluido checkbox no marcado)", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, { langs: ["es"] });
    expect(r.ok).toBe(false);
    const codes = r.errors.filter((e) => e.code === "required").map((e) => e.questionId).sort();
    expect(codes).toEqual(["age", "country", "fullname", "terms"]);
  });

  it("checkbox requerido en false → required", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, {
      fullname: "x",
      age: 1,
      country: "PY",
      terms: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.questionId === "terms" && e.code === "required")).toBe(true);
  });

  it("falla por tipo inválido (number no numérico, date mal formada)", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, {
      fullname: "x",
      age: "abc",
      country: "PY",
      terms: true,
      dob: "01/05/1990",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.questionId === "age" && e.code === "invalid_type")).toBe(true);
    expect(r.errors.some((e) => e.questionId === "dob" && e.code === "invalid_type")).toBe(true);
  });

  it("falla por opción fuera del set (select/multiselect)", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, {
      fullname: "x",
      age: 1,
      country: "BR", // no está en options
      langs: ["es", "fr"], // fr no está
      terms: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.questionId === "country" && e.code === "invalid_option")).toBe(true);
    expect(r.errors.some((e) => e.questionId === "langs" && e.code === "invalid_option")).toBe(true);
  });

  it("rechaza respuestas a preguntas desconocidas (fail-closed)", () => {
    const r = validateQuestionnaireAnswers(QUESTIONS, {
      fullname: "x",
      age: 1,
      country: "PY",
      terms: true,
      hacker: "drop table",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.questionId === "hacker" && e.code === "unknown_question")).toBe(true);
    expect("hacker" in r.answers).toBe(false);
  });
});

describe("questionnaireIdFromWorkflow", () => {
  it("devuelve el id cuando está presente y no deshabilitado", () => {
    expect(questionnaireIdFromWorkflow({ questionnaire: { questionnaireId: "q1" } })).toBe("q1");
    expect(
      questionnaireIdFromWorkflow({ questionnaire: { questionnaireId: "q1", required: true } })
    ).toBe("q1");
  });
  it("devuelve null si ausente, vacío o required:false", () => {
    expect(questionnaireIdFromWorkflow(null)).toBeNull();
    expect(questionnaireIdFromWorkflow({})).toBeNull();
    expect(questionnaireIdFromWorkflow({ questionnaire: { questionnaireId: "" } })).toBeNull();
    expect(
      questionnaireIdFromWorkflow({ questionnaire: { questionnaireId: "q1", required: false } })
    ).toBeNull();
  });
});
