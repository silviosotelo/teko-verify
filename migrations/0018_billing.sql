-- 0018_billing.sql
-- =============================================================================
-- Sprint 1 — Monetización-lite (metering + plan gating, SIN pasarela de pagos).
--
-- 1) billing_plans        — catálogo GLOBAL de planes (NO por tenant). slug = PK.
--                           monthly_quota NULL = ilimitado. Seed idempotente de 4
--                           planes (free/starter/pro/enterprise).
-- 2) tenant_subscriptions — suscripción del tenant a un plan (1:1, tenant_id PK).
--                           Los tenants SIN fila = plan 'free' implícito (no se
--                           siembra fila por tenant: la ausencia ES el free).
-- 3) usage_alerts         — alertas de consumo por umbral (% de la cuota) por tenant.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING + IF NOT EXISTS en
-- índices). NO toca filas ni comportamiento existente: SOLO agrega tablas nuevas. En
-- línea con el patrón de 0007 (workflows) / 0008 (webhooks) / 0016 (questionnaires).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- billing_plans — catálogo GLOBAL (no multi-tenant). `slug` es la PK estable que
-- referencian las suscripciones. `monthly_quota` = verificaciones/mes (NULL =
-- ilimitado). `price_cents` en la `currency` indicada. `features` JSONB libre para
-- flags por plan (sin esquema rígido). `sort_order` para presentar el pricing.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_plans (
  slug          text        PRIMARY KEY,
  name          text        NOT NULL,
  monthly_quota integer,                                 -- NULL = ilimitado
  price_cents   integer     NOT NULL DEFAULT 0,
  currency      text        NOT NULL DEFAULT 'USD',
  features      jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- array de bullets (string[])
  is_active     boolean     NOT NULL DEFAULT true,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed de los 4 planes base. ON CONFLICT DO NOTHING → re-correr no pisa ediciones
-- posteriores hechas por el operador ni duplica filas.
INSERT INTO billing_plans (slug, name, monthly_quota, price_cents, currency, features, sort_order)
VALUES
  ('free',       'Free',          50,   0,     'USD',
    '["50 verificaciones/mes","1 app","Cédula PY (frente y dorso)","Verificación facial 1:1"]'::jsonb, 0),
  ('starter',    'Starter',       500,  4900,  'USD',
    '["500 verificaciones/mes","Hasta 5 apps","AML / PEP screening","Webhooks firmados","Workflows configurables"]'::jsonb, 1),
  ('pro',        'Pro',           5000, 19900, 'USD',
    '["5.000 verificaciones/mes","Apps ilimitadas","Face search 1:N","Proof of address","Cuestionarios + branding"]'::jsonb, 2),
  ('enterprise', 'Enterprise',    NULL, 0,     'USD',
    '["Verificaciones ilimitadas","SLA dedicado","Soporte prioritario","Despliegue on-premise","Revisión manual asistida"]'::jsonb, 3)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- tenant_subscriptions — suscripción del tenant a un plan. tenant_id = PK (1:1).
-- Los tenants SIN fila se tratan como plan 'free' implícito (no se materializa
-- una fila por tenant). `plan_slug` FK a billing_plans. `period_*` definen la
-- ventana de cuota actual (default: now()..now()+1 mes).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id    uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_slug    text        NOT NULL REFERENCES billing_plans(slug),
  status       text        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'past_due', 'canceled')),
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end   timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- usage_alerts — alertas de consumo por umbral (% de la cuota) por tenant. Cuando
-- el uso del período cruza `threshold_pct` se notifica por `channel` a `target`
-- (el disparo/notificación efectivo es trabajo de otra pieza; acá vive la config).
-- `last_fired_at` evita re-disparos. CHECKs de dominio (defensa a nivel DB).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  threshold_pct integer     NOT NULL CHECK (threshold_pct BETWEEN 1 AND 100),
  channel       text        NOT NULL CHECK (channel IN ('email', 'webhook')),
  target        text        NOT NULL,
  enabled       boolean     NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_alerts_tenant ON usage_alerts (tenant_id);
