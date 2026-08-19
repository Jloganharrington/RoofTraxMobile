-- Migration 068: Tenant-scoped preset-role permission overrides.
--
-- The authz registry remains the global fallback. These tables record only
-- company-specific deviations from that registry, plus an append-only audit log.

CREATE TABLE IF NOT EXISTS role_permission_overrides (
  id                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         varchar NOT NULL REFERENCES companies(id),
  role               varchar(32) NOT NULL,
  permission         varchar(100) NOT NULL,
  granted            boolean NOT NULL,
  note               text NOT NULL,
  updated_by_user_id varchar NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS role_permission_overrides_company_role_perm_idx
  ON role_permission_overrides (company_id, role, permission);

CREATE INDEX IF NOT EXISTS role_permission_overrides_company_role_idx
  ON role_permission_overrides (company_id, role);

CREATE TABLE IF NOT EXISTS role_permission_override_changes (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    varchar NOT NULL REFERENCES companies(id),
  role          varchar(32) NOT NULL,
  permission    varchar(100) NOT NULL,
  previous_state varchar(10),
  new_state      varchar(10),
  note          text NOT NULL,
  actor_user_id varchar NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_perm_override_changes_company_role_created_idx
  ON role_permission_override_changes (company_id, role, created_at);