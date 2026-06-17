import { useState } from "react"
import {
  submitQuestionnaire,
  type QuestionnaireQuestion,
  type QuestionnaireAnswers,
  type QuestionnaireAnswerValue,
} from "../api"
import { errorMessage } from "../messages"
import { Button, Card, BackBar, Notice } from "../ui"

/**
 * Paso "Preguntas" (P2) — cuestionario custom por workflow, estilo Didit (marca Teko).
 *
 * Sólo aparece cuando el workflow lo exige (App lo gatea con
 * `status.requiresQuestionnaire` + `status.questionnaire`). Renderiza cada pregunta
 * según su tipo (text/number/date/select/multiselect/checkbox), valida las requeridas
 * del lado cliente y POST-ea las respuestas a /questionnaire. El backend re-valida y
 * persiste (autoridad). Fail-soft: error legible + reintento.
 */
export function Questionnaire({
  title,
  questions,
  onDone,
  onBack,
}: {
  title: string
  questions: QuestionnaireQuestion[]
  onDone: () => void
  onBack?: () => void
}) {
  const [values, setValues] = useState<QuestionnaireAnswers>({})
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())

  function setValue(id: string, v: QuestionnaireAnswerValue) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function isAnswered(q: QuestionnaireQuestion): boolean {
    const v = values[q.id]
    if (q.type === "checkbox") return v === true
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === "string") return v.trim().length > 0
    if (typeof v === "number") return Number.isFinite(v)
    return v !== undefined && v !== null
  }

  async function onSubmit() {
    setErr(null)
    // Validación requeridas del lado cliente (el backend es la autoridad igual).
    const miss = new Set<string>()
    for (const q of questions) {
      if (q.required && !isAnswered(q)) miss.add(q.id)
    }
    setMissing(miss)
    if (miss.size > 0) {
      setErr("Completá los campos obligatorios.")
      return
    }
    setSubmitting(true)
    try {
      await submitQuestionnaire(values)
      onDone()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <BackBar onBack={onBack} />
        <h1 className="text-xl font-bold text-gray-900">{title || "Algunas preguntas"}</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Respondé estas preguntas para continuar con tu verificación.
        </p>

        <div className="mt-5 flex flex-col gap-5">
          {questions.map((q) => (
            <Field
              key={q.id}
              q={q}
              value={values[q.id]}
              invalid={missing.has(q.id)}
              onChange={(v) => setValue(q.id, v)}
            />
          ))}
        </div>

        {err && <Notice>{err}</Notice>}

        <div className="mt-6">
          <Button disabled={submitting} onClick={() => void onSubmit()}>
            {submitting ? "Enviando…" : "Continuar"}
          </Button>
        </div>
      </div>
    </Card>
  )
}

const labelCls = "mb-1.5 block text-sm font-semibold text-gray-800"
const inputCls =
  "w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"

function Field({
  q,
  value,
  invalid,
  onChange,
}: {
  q: QuestionnaireQuestion
  value: QuestionnaireAnswerValue | undefined
  invalid: boolean
  onChange: (v: QuestionnaireAnswerValue) => void
}) {
  const ring = invalid ? " border-error ring-2 ring-error/15" : ""

  // checkbox: una sola casilla (la etiqueta va al lado).
  if (q.type === "checkbox") {
    const checked = value === true
    return (
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 rounded-md border-gray-300 text-primary focus:ring-primary"
        />
        <span className="text-sm text-gray-800">
          {q.label}
          {q.required && <span className="text-error"> *</span>}
        </span>
      </label>
    )
  }

  return (
    <div>
      <label className={labelCls}>
        {q.label}
        {q.required && <span className="text-error"> *</span>}
      </label>

      {q.type === "text" && (
        <input
          type="text"
          className={inputCls + ring}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "number" && (
        <input
          type="number"
          inputMode="decimal"
          className={inputCls + ring}
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "date" && (
        <input
          type="date"
          className={inputCls + ring}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {q.type === "select" && (
        <select
          className={inputCls + ring}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Elegí una opción…</option>
          {(q.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      {q.type === "multiselect" && (
        <div className="flex flex-col gap-2">
          {(q.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? value : []
            const checked = arr.includes(o)
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition ${
                  checked ? "border-primary bg-primary-subtle/40" : "border-gray-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...arr, o]
                      : arr.filter((x) => x !== o)
                    onChange(next)
                  }}
                  className="size-5 shrink-0 rounded-md border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm text-gray-800">{o}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
