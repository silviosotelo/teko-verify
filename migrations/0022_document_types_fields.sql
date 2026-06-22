-- migrations/0022_document_types_fields.sql
-- =============================================================================
-- Fase 4 — Extensibilidad doc/campos.
-- document_types: catálogo de tipos de documento soportados.
-- extraction_fields: campos por tipo + reglas de validación DECLARATIVAS.
--
-- validation JSONB schema:
--   { required?: boolean, regex?: string,
--     normalize?: 'uppercase'|'trim',
--     dateRange?: { minIso?: string, maxIso?: string } }
--
-- Seed = ESPEJO EXACTO de src/modules/document.ts:
--   required=true en los 5 campos que forman requiredPresent hardcodeado.
--   Los campos opcionales se incluyen con validation='{}' para que la UI
--   los muestre, pero no afectan passed.
-- ON CONFLICT DO NOTHING → re-correr NO pisa ediciones del operador.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_types (
  key         text        PRIMARY KEY,
  label       text        NOT NULL,
  country     text        NOT NULL DEFAULT 'PY',
  mrz_format  text        CHECK (mrz_format IN ('td1', 'td3')),
  enabled     boolean     NOT NULL DEFAULT true,
  scope_type  text        NOT NULL DEFAULT 'system'
                          CHECK (scope_type IN ('system', 'tenant')),
  scope_id    uuid,       -- NULL = system
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_types_enabled
  ON document_types (key) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS extraction_fields (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type_key    text        NOT NULL REFERENCES document_types(key) ON DELETE CASCADE,
  key             text        NOT NULL,
  label           text        NOT NULL,
  type            text        NOT NULL DEFAULT 'string'
                              CHECK (type IN ('string','date','boolean','number')),
  path            text        NOT NULL,  -- dotted path into ExtractedDocument
  validation      jsonb       NOT NULL DEFAULT '{}',
  display_order   integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_type_key, key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_fields_doc_type
  ON extraction_fields (doc_type_key, display_order);

-- ─── Seed document_types ─────────────────────────────────────────────────────
INSERT INTO document_types (key, label, country, mrz_format, enabled, scope_type)
VALUES
  ('ci_py',    'Cédula de Identidad Civil (PY)', 'PY', 'td1', true, 'system'),
  ('passport', 'Pasaporte ICAO',                 'XX', 'td3', true, 'system')
ON CONFLICT DO NOTHING;

-- ─── Seed extraction_fields — ci_py (espejo exacto del hardcodeado) ──────────
-- required=true exactamente en los 5 paths de requiredPresent en runCedulaPy.
INSERT INTO extraction_fields
  (doc_type_key, key, label, type, path, validation, display_order)
VALUES
  ('ci_py','apellidos',        'Apellidos',         'string','titular.apellidos',               '{"required":true}', 10),
  ('ci_py','nombres',          'Nombres',           'string','titular.nombres',                 '{"required":true}', 20),
  ('ci_py','numeroCedula',     'Nº Cédula',         'string','documento.numeroCedula',           '{"required":true}', 30),
  ('ci_py','fechaNacimiento',  'Fecha nacimiento',  'date',  'titular.fechaNacimiento',         '{"required":true}', 40),
  ('ci_py','fechaVencimiento', 'Fecha vencimiento', 'date',  'documentoFisico.fechaVencimiento','{"required":true}', 50),
  ('ci_py','sexo',             'Sexo',              'string','titular.sexo',                    '{}',                60),
  ('ci_py','lugarNacimiento',  'Lugar nacimiento',  'string','titular.lugarNacimiento.ciudad',  '{}',                70),
  ('ci_py','nacionalidad',     'Nacionalidad',      'string','titular.nacionalidad',             '{}',                80),
  ('ci_py','estadoCivil',      'Estado civil',      'string','titular.estadoCivil',              '{}',                90),
  ('ci_py','donante',          'Donante',           'boolean','titular.donante',                '{}',               100),
  ('ci_py','fechaEmision',     'Fecha emisión',     'date',  'documentoFisico.fechaEmision',    '{}',               110),
  ('ci_py','ic',               'IC registro',       'string','registroInterno.ic',              '{}',               120)
ON CONFLICT DO NOTHING;

-- ─── Seed extraction_fields — passport (espejo exacto del hardcodeado) ────────
-- required=true exactamente en los 5 paths de requiredPresent en runPassport.
INSERT INTO extraction_fields
  (doc_type_key, key, label, type, path, validation, display_order)
VALUES
  ('passport','apellidos',        'Apellidos',         'string','titular.apellidos',               '{"required":true}', 10),
  ('passport','nombres',          'Nombres',           'string','titular.nombres',                 '{"required":true}', 20),
  ('passport','numeroPasaporte',  'Nº pasaporte',      'string','documento.numeroCedula',           '{"required":true}', 30),
  ('passport','fechaNacimiento',  'Fecha nacimiento',  'date',  'titular.fechaNacimiento',         '{"required":true}', 40),
  ('passport','fechaVencimiento', 'Fecha vencimiento', 'date',  'documentoFisico.fechaVencimiento','{"required":true}', 50),
  ('passport','sexo',             'Sexo',              'string','titular.sexo',                    '{}',                60),
  ('passport','nacionalidad',     'Nacionalidad',      'string','titular.nacionalidad',             '{}',                70),
  ('passport','paisCodigo',       'País código MRZ',   'string','mrz.paisCodigo',                  '{}',                80)
ON CONFLICT DO NOTHING;
