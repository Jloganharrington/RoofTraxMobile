-- Selections Library — internal catalog for the Selections Portal.
-- Hierarchy: Category → Brand → Product (tier) → Options (colours).
-- Applied 2026-08-07.

-- 1. Categories (company-scoped; NOT an enum — fully configurable per company)
CREATE TABLE IF NOT EXISTS selection_categories (
  id          varchar         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  varchar         NOT NULL REFERENCES companies(id),
  name        varchar(120)    NOT NULL,
  slug        varchar(80)     NOT NULL,
  sort_order  integer         NOT NULL DEFAULT 0,
  is_active   boolean         NOT NULL DEFAULT true,
  created_at  timestamptz     NOT NULL DEFAULT now(),
  updated_at  timestamptz     NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS selection_categories_company_slug_idx
  ON selection_categories (company_id, slug);

-- 2. Brands (belong to exactly one category within a company;
--    same brand name under a different category is a separate row)
CREATE TABLE IF NOT EXISTS selection_brands (
  id          varchar         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  varchar         NOT NULL REFERENCES companies(id),
  category_id varchar         NOT NULL REFERENCES selection_categories(id),
  name        varchar(120)    NOT NULL,
  logo_path   text            NULL,
  sort_order  integer         NOT NULL DEFAULT 0,
  is_active   boolean         NOT NULL DEFAULT true,
  created_at  timestamptz     NOT NULL DEFAULT now(),
  updated_at  timestamptz     NOT NULL DEFAULT now()
);

-- 3. Products / tiers (price-bearing; is_base is CATEGORY-scoped, not brand-scoped)
CREATE TABLE IF NOT EXISTS selection_products (
  id                varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        varchar     NOT NULL REFERENCES companies(id),
  category_id       varchar     NOT NULL REFERENCES selection_categories(id),
  brand_id          varchar     NOT NULL REFERENCES selection_brands(id),
  name              varchar(200) NOT NULL,
  description       text,
  specs             jsonb,
  is_base           boolean     NOT NULL DEFAULT false,
  price_delta_cents integer     NOT NULL DEFAULT 0,  -- PER UNIT; delta above category base
  unit              varchar(60) NOT NULL,             -- e.g. "per square", "per LF"
  sort_order        integer     NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Enforce exactly one active base product per company+category (across ALL brands)
CREATE UNIQUE INDEX IF NOT EXISTS selection_products_one_base_per_category_idx
  ON selection_products (company_id, category_id)
  WHERE is_base = true AND is_active = true;

-- 4. Options / colours (attached to BRAND, no price impact)
CREATE TABLE IF NOT EXISTS selection_options (
  id                 varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         varchar     NOT NULL REFERENCES companies(id),
  brand_id           varchar     NOT NULL REFERENCES selection_brands(id),
  name               varchar(120) NOT NULL,
  option_group       varchar(80)  NULL,      -- e.g. "Light", "Deep", "Cedar Colors"
  swatch_hex         varchar(7)   NULL,      -- #RRGGBB
  swatch_image_path  text         NULL,      -- object storage path; textures / woodgrain
  hoa_compliant      boolean      NULL,      -- tri-state: true / false / NULL (unknown)
  sort_order         integer      NOT NULL DEFAULT 0,
  is_active          boolean      NOT NULL DEFAULT true,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
-- At least one of swatch_hex or swatch_image_path must be non-null (enforced server-side)

-- 5. Product–option availability mapping
--    VALIDATE: option.brand_id must equal product.brand_id (enforced server-side)
CREATE TABLE IF NOT EXISTS selection_product_options (
  id          varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  varchar     NOT NULL REFERENCES companies(id),
  product_id  varchar     NOT NULL REFERENCES selection_products(id),
  option_id   varchar     NOT NULL REFERENCES selection_options(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, option_id)
);

-- Seed four default categories for every existing company
INSERT INTO selection_categories (company_id, name, slug, sort_order)
SELECT id, 'Roofing',  'roofing',  0 FROM companies ON CONFLICT DO NOTHING;

INSERT INTO selection_categories (company_id, name, slug, sort_order)
SELECT id, 'Siding',   'siding',   1 FROM companies ON CONFLICT DO NOTHING;

INSERT INTO selection_categories (company_id, name, slug, sort_order)
SELECT id, 'Gutters',  'gutters',  2 FROM companies ON CONFLICT DO NOTHING;

INSERT INTO selection_categories (company_id, name, slug, sort_order)
SELECT id, 'Interior', 'interior', 3 FROM companies ON CONFLICT DO NOTHING;
