# AML / PEP / Sanctions Screening (P1 #1)

Screening de listas de sanciones y personas políticamente expuestas (PEP) por
**matching LOCAL on-prem**. El nombre/PII del titular **nunca** sale del servidor:
el cruce corre 100% contra una copia local del dataset (`aml_entities`), nunca
contra una API externa comercial.

## Por qué local (Ley 7593/2025 + soberanía de datos)

La identidad extraída del documento es PII sensible. Mandarla a una API de
screening de terceros (ComplyAdvantage, Refinitiv, etc.) implicaría exportar el
nombre del cliente fuera del país/infra. La arquitectura elegida descarga el
dataset al server y hace el fuzzy-match en proceso; lo único que "viaja" es a la
propia base de datos del 34.

## Arquitectura

```
documento (OCR/MRZ) ──► AmlInput {nombres, apellidos, fechaNac, nacionalidad}
                              │
        pipeline.runAml (sólo si workflow.aml.required)  ── fail-closed
                              │
        modules/aml.screen(input, provider, {threshold})
            ├─ provider.candidates(input)  ── repos/amlEntities.candidates()
            │     prefiltro COARSE por overlap de tokens (índice GIN en `tokens`)
            └─ screenEntities(input, candidates)  ── PURO, testeable sin DB
                  Jaro-Winkler + token-sort + coverage
                  + boost por dob (exact/year) y nacionalidad
                              │
                  AmlResult {hits[], topScore, decision, threshold, provider, ...}
                              │
        persistencia: verification_checks tipo `aml` (detail JSONB)
                              │
        ruteo: shouldRouteToReview(... amlDecision) — onMatch:'review' → in_review
```

### Componentes

| Pieza | Archivo | Rol |
|---|---|---|
| Matching puro | `src/modules/aml.ts` | normalización, Jaro-Winkler, `screenEntities`, `screen` |
| Provider local | `src/modules/amlProvider.ts` | `createLocalAmlProvider` (pluggable) |
| Repo | `src/db/repos/amlEntities.ts` | `candidates` (GIN overlap), `upsert`, `count`, `datasetVersion` |
| Migración | `migrations/0010_aml_screening.sql` | `aml_entities`, `aml_dataset_meta`, check `aml`, workflow `aml-screening` |
| Import | `scripts/aml-import.mjs` | descarga/carga del CSV de OpenSanctions |
| Wiring pipeline | `src/pipeline.ts` (`runAml`), `src/pipelineDeps.ts` | corre el check si el workflow lo exige |
| Ruteo | `src/lib/workflow.ts` (`shouldRouteToReview`) | potential_match + onMatch:review → cola humana |
| UI | `admin/.../SessionDetail.tsx` (`AmlPanel`) | pestaña "AML / Sanciones" con hits |

## Modelo de datos

- **`aml_entities`** (global, NO scopeada por tenant): `entity_id` (PK, id estable
  de la fuente), `name`/`name_norm`, `aliases`/`lists`/`topics`/`countries` (jsonb),
  `birth_date`, `tokens text[]` (índice GIN para el prefiltro coarse por overlap `&&`).
- **`aml_dataset_meta`**: `source` (PK), `version`, `entity_count`, `refreshed_at`.

No usa `pg_trgm` ni extensiones: el prefiltro es overlap de arreglos nativo (GIN).

## Workflow

`WorkflowDefinition.aml = { required, threshold?, onMatch? }`:

- `required`: el check corre.
- `threshold`: similitud (0..1) para `potential_match` (default `AML_MATCH_THRESHOLD`=0.85).
- `onMatch`:
  - `review` → un `potential_match` rutea **siempre** a la cola de revisión humana
    (`in_review`), aun con `review.mode:auto`.
  - `flag` (default) → sólo persiste el hallazgo, no frena la auto-decisión.

La migración siembra un workflow no-default `aml-screening` (L2 + AML onMatch:review)
por tenant.

## Decisión y fail-closed

El AML **no es rechazo duro**: produce señal/score, `decision()` no lo consume.
Si el módulo no está cableado o lanza, `runAml` devuelve un resultado
`potential_match` con `error` (fail-closed) — un workflow con `onMatch:review`
igualmente manda a revisión humana en vez de dejar pasar un screening que no corrió.

## Import / refresh del dataset

```bash
# En el server (red docker; DATABASE_URL ya en el entorno del container):
#   colección de sanciones:
node scripts/aml-import.mjs \
  --url https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv \
  --collection sanctions
#   PEPs:
node scripts/aml-import.mjs \
  --url https://data.opensanctions.org/datasets/latest/peps/targets.simple.csv \
  --collection peps
#   desde archivo ya descargado:
node scripts/aml-import.mjs --file /home/soporte/teko/data/aml/sanctions.simple.csv --collection sanctions
```

Refresh = volver a correr (upsert idempotente `ON CONFLICT (entity_id)`).
`--truncate` para full reload, `--limit N` para pruebas.

### MITM SSL corporativo

Si la descarga falla por `SELF_SIGNED_CERT_IN_CHAIN` (proxy corporativo), bajar el
CSV con `curl -k` y correr el import con `--file`, o exportar
`NODE_TLS_REJECT_UNAUTHORIZED=0` **solo** para esa descarga.

## ⚠️ Licencia (uso comercial)

El dataset consolidado de **OpenSanctions** es gratuito **sólo para uso NO
comercial**. Para producción comercial se debe **licenciar OpenSanctions**
(o usar otra fuente: listas oficiales OFAC/UN/EU/UK descargadas directo, o un
vendor on-prem). La arquitectura (provider pluggable detrás de `AmlProvider` +
tabla local) permite cambiar de fuente **sin tocar el pipeline ni el matching**:
basta repoblar `aml_entities` con otro import. Este PoC usa OpenSanctions por
conveniencia de cobertura; el caveat de licencia debe resolverse antes de
go-live comercial.

## Calibración

- `AML_MATCH_THRESHOLD` (env, default 0.85) — umbral global; el workflow lo
  sobreescribe por sesión (`aml.threshold`).
- Boosts: dob exacta `+0.08`, mismo año `+0.04`, año distinto `-0.05`,
  nacionalidad `+0.03`. El nombre es el driver primario (sin nombre no hay hit).
