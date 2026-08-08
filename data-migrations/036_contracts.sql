-- Contract Builder — contracts, scope packages, and selections (migration 036).
-- Applied 2026-08-08.
--
-- Pricing model:
--   covered_scope_cents   Carrier pays (settlement anchor — real number, not a formula)
--   betterments_cents     DERIVED: SUM(contract_selections.extended_delta_cents)
--   deductible_cents      Homeowner pays (known at signing)
--   total_contract_cents  DERIVED: covered_scope + betterments
--   Homeowner out-of-pocket = deductible + betterments  (fully known at signature)

-- ── 1. contracts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                      varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              varchar       NOT NULL REFERENCES companies(id),
  pin_id                  varchar       NOT NULL REFERENCES pins(id) ON DELETE CASCADE,

  -- Access: code generated at creation; exposed to customer only when status='sent'
  access_code             varchar       NOT NULL,
  access_code_expires_at  timestamptz   NULL,

  -- Status lifecycle: draft → sent → signed   (or any → voided)
  status                  varchar       NOT NULL DEFAULT 'draft',
  sent_at                 timestamptz   NULL,

  -- Pricing (all integer cents)
  -- betterments_cents + total_contract_cents are DERIVED — never hand-set
  covered_scope_cents     integer       NOT NULL DEFAULT 0,
  betterments_cents       integer       NOT NULL DEFAULT 0,
  deductible_cents        integer       NOT NULL DEFAULT 0,
  total_contract_cents    integer       NOT NULL DEFAULT 0,

  -- Scope narrative
  scope_summary           text          NULL,
  scope_source            varchar       NULL,   -- 'estimate' | 'manual'

  -- Document + signature
  template_id             varchar       NULL REFERENCES company_templates(id) ON DELETE SET NULL,
  document_object_path    text          NULL,
  document_sha256         text          NULL,
  customer_signature_path text          NULL,
  customer_signed_at      timestamptz   NULL,
  customer_print_name     varchar       NULL,
  rep_signature_path      text          NULL,
  rep_signed_at           timestamptz   NULL,

  -- Void (contingency: claim denied, customer withdrew)
  voided_at               timestamptz   NULL,
  voided_by_user_id       varchar       NULL REFERENCES users(id),
  void_reason             text          NULL,

  created_by_user_id      varchar       NOT NULL REFERENCES users(id),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

-- One live (non-voided) contract per pin; voiding frees the pin for a replacement
CREATE UNIQUE INDEX IF NOT EXISTS contracts_one_active_per_pin_idx
  ON contracts (pin_id) WHERE voided_at IS NULL;

-- Fast lookup by access_code for the public portal
CREATE INDEX IF NOT EXISTS contracts_access_code_idx
  ON contracts (access_code);

-- ── 2. contract_scope_packages ────────────────────────────────────────────────
-- Which selection categories are in play, and the quantity that prices them.
-- Contract Builder creates these; the Portal renders selections for exactly
-- these categories and no others.
CREATE TABLE IF NOT EXISTS contract_scope_packages (
  id                   varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           varchar   NOT NULL REFERENCES companies(id),
  contract_id          varchar   NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  category_id          varchar   NOT NULL REFERENCES selection_categories(id),
  quantity             numeric   NOT NULL,        -- 28 squares, 140 LF
  unit                 varchar   NOT NULL,         -- must match the products' unit
  covered_amount_cents integer   NOT NULL DEFAULT 0,
  sort_order           integer   NOT NULL DEFAULT 0,
  UNIQUE (contract_id, category_id)
);

-- ── 3. contract_selections ────────────────────────────────────────────────────
-- What the customer chose. One row per scope package.
-- SNAPSHOT pattern: resolved at selection time, never re-read from the library.
-- If an admin edits a product's price_delta_cents later, signed contracts are unaffected.
CREATE TABLE IF NOT EXISTS contract_selections (
  id                   varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           varchar   NOT NULL REFERENCES companies(id),
  contract_id          varchar   NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  scope_package_id     varchar   NOT NULL REFERENCES contract_scope_packages(id),
  product_id           varchar   NOT NULL REFERENCES selection_products(id),
  option_id            varchar   NULL REFERENCES selection_options(id),

  -- Snapshot values — resolved at selection time, never mutated
  product_name         varchar   NOT NULL,
  brand_name           varchar   NOT NULL,
  option_name          varchar   NULL,
  unit_delta_cents     integer   NOT NULL,          -- price_delta_cents at time of selection
  quantity             numeric   NOT NULL,           -- copied from scope_package.quantity
  extended_delta_cents integer   NOT NULL,           -- unit_delta_cents × quantity

  selected_by          varchar   NOT NULL,           -- 'customer' | 'rep'
  selected_by_user_id  varchar   NULL REFERENCES users(id),
  selected_at          timestamptz NOT NULL DEFAULT now(),

  -- One selection per scope package per contract
  UNIQUE (contract_id, scope_package_id)
);
