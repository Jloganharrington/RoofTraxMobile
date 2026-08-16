-- NuHome Exteriors — PP subscriber onboarding seed
-- Provisions the second PP-only tenant (NuHome Exteriors) with all data
-- required for a passing compile-readiness check.
--
-- Password: NuHome2024! (scrypt hash, same algorithm as pp/crypto.ts)
-- Login:    admin@nuhomeexteriors.com
-- Run once against the target database; idempotent (uses ON CONFLICT DO NOTHING / WHERE NOT EXISTS).

BEGIN;

-- ── 1. Company ──────────────────────────────────────────────────────────────
INSERT INTO companies (
  id,
  name,
  pp_tier,
  subscription_level,
  contractor_licenses,
  qualifications_text,
  pricing_basis_statement
)
VALUES (
  'NUHOME',
  'NuHome Exteriors',
  'pp_only',
  'none',
  '[{"state":"VA","number":"2705-123456A","classification":"VA Class A Contractor"},{"state":"MD","number":"MHIC-123456","classification":"MD Home Improvement Contractor"}]',
  'NuHome Exteriors is a licensed, insured, and bonded exterior restoration contractor serving residential and commercial clients throughout Virginia and Maryland. Our certified inspectors hold current HAAG Engineering certifications for residential and commercial roofing and have completed manufacturer-certified installation training for all product lines used in our work. NuHome Exteriors maintains comprehensive general liability coverage and workers'' compensation insurance in all jurisdictions where we operate.',
  'All prices are based on documented roof measurements, confirmed material specifications, and prevailing regional labor rates for licensed contractors. Unit prices reflect standard replacement-grade materials meeting or exceeding the original installation and applicable code requirements for the jurisdiction. Prices do not include permit fees, permit-administration services, or code-required upgrades beyond the documented scope; such items are priced separately under the applicable Price Book item or written change order.'
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Founder user ─────────────────────────────────────────────────────────
-- password_hash is intentionally NULL — the account cannot be used until
-- the founder sets a password via POST /pp/password-reset.
-- email_verified_at is also left NULL until the reset link is clicked.
-- Never store a static credential in a tracked migration file.
INSERT INTO users (
  company_id,
  email,
  created_at,
  updated_at
)
VALUES (
  'NUHOME',
  'admin@nuhomeexteriors.com',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- ── 3. Set founder_user_id ───────────────────────────────────────────────────
UPDATE companies
SET founder_user_id = (SELECT id FROM users WHERE email = 'admin@nuhomeexteriors.com')
WHERE id = 'NUHOME'
  AND founder_user_id IS NULL;

-- ── 4. User profile (admin role) ─────────────────────────────────────────────
INSERT INTO user_profiles (user_id, role, department)
SELECT id, 'admin', 'inspector_canvasser'
FROM users
WHERE email = 'admin@nuhomeexteriors.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── 5. Price book seed ───────────────────────────────────────────────────────
INSERT INTO price_book_items (id, company_id, name, unit, unit_price, description)
SELECT
  gen_random_uuid()::text,
  'NUHOME',
  seed.name,
  seed.unit,
  0,
  seed.description
FROM (
  VALUES
  (
    'Standard Asphalt Shingle Roof System Replacement',
    'SQ',
    'Remove one existing layer of standard asphalt roofing material and furnish and install a complete standard asphalt roofing system. Includes synthetic underlayment, ice-and-water shield, starter course, field shingles, hip and ridge cap, drip edge, and complete flashing systems. Includes ordinary tear-off labor, loading, transportation, disposal, installation labor, and standard jobsite cleanup.'
  ),
  (
    'Standard Vinyl Siding System Replacement',
    'SF',
    'Remove one existing layer of standard siding material and furnish and install a complete standard-grade vinyl siding system. Includes weather-resistive barrier, starter strip, horizontal field panels, corner posts, J-channel, utility trim, and integration with existing serviceable flashing. Includes ordinary removal labor, loading, transportation, disposal, installation labor, and standard jobsite cleanup.'
  ),
  (
    'Emergency Temporary Repair Services',
    'EA',
    'Furnish and install temporary weather protection to arrest ongoing water intrusion until permanent repairs can be performed. Includes emergency mobilization, initial damage assessment, temporary covering material, fasteners, removal of loose debris, routine material handling, standard jobsite cleanup, and photographic documentation.'
  )
) AS seed(name, unit, description)
WHERE NOT EXISTS (
  SELECT 1 FROM price_book_items
  WHERE company_id = 'NUHOME' AND name = seed.name
);

-- ── 6. AHJ pack (Virginia — roofing) ────────────────────────────────────────
-- Direct pack so the company passes the AHJ gate without requiring a master
-- pack to exist in this environment.
INSERT INTO ahj_packs (
  company_id,
  pack_type,
  jurisdiction,
  state,
  county,
  items,
  version,
  created_by
)
SELECT
  'NUHOME',
  'ahj_roof',
  'Fairfax County, VA',
  'VA',
  'Fairfax County',
  '[
    {"key":"roof_covering","element":"Roof Covering","title":"IRC 2021 §R905","cite":"IRC 2021 §R905","body":"Roof coverings shall be applied in accordance with the applicable provisions of this section and the manufacturer installation instructions. Asphalt shingles shall comply with ASTM D3161 Class F and ASTM D7158 Class H wind ratings."},
    {"key":"drip_edge","element":"Drip Edge","title":"IRC 2021 §R905.2.8.5","cite":"IRC 2021 §R905.2.8.5","body":"A drip edge shall be provided at eaves and gables of shingle roofs. The drip edge shall extend not less than 0.25 inches below the roof sheathing and extend up the roof deck not less than 2 inches."},
    {"key":"ice_water","element":"Ice Barrier","title":"IRC 2021 §R905.1.2","cite":"IRC 2021 §R905.1.2","body":"In areas where there has been a history of ice forming along the eaves causing a backup of water, an ice barrier that consists of not fewer than two layers of underlayment cemented together or a self-adhering polymer-modified bitumen sheet shall be used in lieu of normal underlayment."},
    {"key":"underlayment","element":"Underlayment","title":"IRC 2021 §R905.2.7","cite":"IRC 2021 §R905.2.7","body":"Underlayment for asphalt shingles shall be required per IRC 2021 §R905.2.7 and shall comply with ASTM D226 Type I or II, ASTM D4869 Type I or II, or ASTM D6757."},
    {"key":"ventilation","element":"Attic Ventilation","title":"IRC 2021 §R806","cite":"IRC 2021 §R806","body":"Enclosed attics and enclosed rafter spaces formed where ceilings are applied directly to the underside of roof rafters shall have cross ventilation for each separate space by ventilating openings protected against the entrance of rain or snow."}
  ]'::jsonb,
  1,
  (SELECT id FROM users WHERE email = 'admin@nuhomeexteriors.com')
WHERE NOT EXISTS (
  SELECT 1 FROM ahj_packs
  WHERE company_id = 'NUHOME' AND pack_type = 'ahj_roof' AND jurisdiction = 'Fairfax County, VA'
);

-- ── 7. AHJ pack (Virginia — siding) ─────────────────────────────────────────
INSERT INTO ahj_packs (
  company_id,
  pack_type,
  jurisdiction,
  state,
  county,
  items,
  version,
  created_by
)
SELECT
  'NUHOME',
  'ahj_siding',
  'Fairfax County, VA',
  'VA',
  'Fairfax County',
  '[
    {"key":"siding_material","element":"Siding Material","title":"IRC 2021 §R703","cite":"IRC 2021 §R703","body":"Exterior wall coverings shall be designed and constructed to resist wind pressures and to be watertight. Vinyl siding shall comply with ASTM D3679 and shall be installed in accordance with the manufacturer installation instructions."},
    {"key":"weather_barrier","element":"Weather-Resistive Barrier","title":"IRC 2021 §R703.2","cite":"IRC 2021 §R703.2","body":"The exterior wall envelope shall include a water-resistive barrier behind the exterior cladding and a means for draining any water that enters the envelope to the exterior."},
    {"key":"flashing","element":"Flashing","title":"IRC 2021 §R703.4","cite":"IRC 2021 §R703.4","body":"Flashing shall be installed at the intersection of the roof with vertical surfaces, at window and door openings, at penetrations, and at other locations as required to prevent water entry."}
  ]'::jsonb,
  1,
  (SELECT id FROM users WHERE email = 'admin@nuhomeexteriors.com')
WHERE NOT EXISTS (
  SELECT 1 FROM ahj_packs
  WHERE company_id = 'NUHOME' AND pack_type = 'ahj_siding' AND jurisdiction = 'Fairfax County, VA'
);

-- ── 8. Jurisdiction pack (Virginia) ──────────────────────────────────────────
INSERT INTO company_jurisdiction_packs (
  company_id,
  jurisdiction,
  state,
  opening_statements,
  uppa_law,
  uppa_statement,
  general_code_citations,
  roofing_code_citations,
  siding_code_citations,
  updated_at
)
SELECT
  'NUHOME',
  'Fairfax County, VA',
  'VA',
  '[{"title":"2021 International Residential Code (IRC), as adopted by Virginia","body":"The 2021 International Residential Code (IRC) as adopted and amended by the Virginia Uniform Statewide Building Code (USBC), effective January 18, 2022, governs this repair work."},{"title":"Virginia Uniform Statewide Building Code (USBC), 2021 Edition","body":"This inspection and the referenced scope of repairs are governed by the Virginia USBC 2021 Edition, which adopts the 2021 IRC with Virginia amendments."}]'::jsonb,
  'Virginia Code §38.2-2226 (Valued Policy Law)',
  'Under Virginia Code §38.2-2226, when an insured property suffers total loss, the insurer shall pay the full insured value without deduction. For partial losses, the insurer is required to indemnify the policyholder for the actual cost to return the damaged property to its pre-loss condition using like kind and quality materials and workmanship, including all code-required upgrades necessitated by the repair.',
  '[]'::jsonb,
  '[{"key":"permit","element":"Building Permit","title":"USBC 2021 §105","cite":"USBC 2021 §105","body":"A building permit is required for any roofing work that involves replacement of more than 25% of the roof area within any 12-month period. Permit fees are not included in this estimate and will be added as a separate line item."}]'::jsonb,
  '[{"key":"permit","element":"Building Permit","title":"USBC 2021 §105","cite":"USBC 2021 §105","body":"A building permit is required for siding replacement that involves replacement of more than 25% of the exterior wall area within any 12-month period. Permit fees are not included in this estimate and will be added as a separate line item."}]'::jsonb,
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM company_jurisdiction_packs
  WHERE company_id = 'NUHOME' AND jurisdiction = 'Fairfax County, VA'
);

COMMIT;
