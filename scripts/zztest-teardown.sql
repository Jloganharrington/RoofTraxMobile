-- ZZTEST Teardown Script
-- Deletes all test fixture data created with ZZTEST_ prefix.
-- Safe to run twice (idempotent). Never touches non-ZZTEST data.
-- Run order: children before parents to avoid FK violations.

BEGIN;

-- Sessions for ZZTEST users
DELETE FROM sessions
  WHERE data::jsonb -> 'user' ->> 'companyId' LIKE 'ZZTEST%';

-- Notification preferences
DELETE FROM notification_preferences
  WHERE company_id LIKE 'ZZTEST%';

-- User push tokens
DELETE FROM user_push_tokens
  WHERE company_id LIKE 'ZZTEST%';

-- Stage transitions for ZZTEST pins
DELETE FROM stage_transitions
  WHERE lead_id IN (SELECT id FROM pins WHERE company_id LIKE 'ZZTEST%');

-- Claim events / timeline
DELETE FROM claim_events
  WHERE pin_id IN (SELECT id FROM pins WHERE company_id LIKE 'ZZTEST%');

-- Claim status history
DELETE FROM claim_status_history
  WHERE pin_id IN (SELECT id FROM pins WHERE company_id LIKE 'ZZTEST%');

-- Contracts and related
DELETE FROM contract_selections
  WHERE contract_id IN (SELECT id FROM contracts WHERE company_id LIKE 'ZZTEST%');
DELETE FROM contract_scope_packages
  WHERE contract_id IN (SELECT id FROM contracts WHERE company_id LIKE 'ZZTEST%');
DELETE FROM contracts
  WHERE company_id LIKE 'ZZTEST%';

-- Change orders and line items
DELETE FROM change_order_line_items
  WHERE change_order_id IN (SELECT id FROM change_orders WHERE company_id LIKE 'ZZTEST%');
DELETE FROM change_orders
  WHERE company_id LIKE 'ZZTEST%';

-- Payments, invoices, expenses
DELETE FROM payments     WHERE company_id LIKE 'ZZTEST%';
DELETE FROM customer_invoices WHERE company_id LIKE 'ZZTEST%';
DELETE FROM vendor_expenses WHERE company_id LIKE 'ZZTEST%';

-- Signed agreements / FIPSA
DELETE FROM signed_agreements
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');

-- Inspection sub-records
DELETE FROM comparison_set_captions
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_comparison_pairs
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM exhibit_captions
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_exhibit_selections
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM claim_sections
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM report_attestations
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM attestations
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_addenda
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_photos
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_components
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_elevations
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_slopes
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_products
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_interior_observations
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_penetrations
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM inspection_siding_facets
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM damage_instances
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM test_square_hits
  WHERE test_square_id IN (
    SELECT id FROM test_squares
    WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%')
  );
DELETE FROM test_squares
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM measurements
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');
DELETE FROM claim_status_history
  WHERE pin_id IN (SELECT id FROM pins WHERE company_id LIKE 'ZZTEST%');
DELETE FROM claim_supplements
  WHERE inspection_id IN (SELECT id FROM inspections WHERE company_id LIKE 'ZZTEST%');

-- Inspections
DELETE FROM inspections WHERE company_id LIKE 'ZZTEST%';

-- Lead files
DELETE FROM lead_files
  WHERE pin_id IN (SELECT id FROM pins WHERE company_id LIKE 'ZZTEST%');

-- Pins
DELETE FROM pins WHERE company_id LIKE 'ZZTEST%';

-- Canvassing sessions
DELETE FROM canvassing_sessions
  WHERE user_id IN (SELECT id FROM users WHERE company_id LIKE 'ZZTEST%');

-- User locations
DELETE FROM user_locations
  WHERE user_id IN (SELECT id FROM users WHERE company_id LIKE 'ZZTEST%');

-- User profiles
DELETE FROM user_profiles
  WHERE user_id IN (SELECT id FROM users WHERE company_id LIKE 'ZZTEST%');

-- Users
DELETE FROM users WHERE company_id LIKE 'ZZTEST%';

-- Company-level tables
DELETE FROM selection_products  WHERE company_id LIKE 'ZZTEST%';
DELETE FROM selection_brands    WHERE company_id LIKE 'ZZTEST%';
DELETE FROM selection_categories WHERE company_id LIKE 'ZZTEST%';
DELETE FROM company_templates   WHERE company_id LIKE 'ZZTEST%';
DELETE FROM company_crm_config  WHERE company_id LIKE 'ZZTEST%';
DELETE FROM company_jurisdiction_packs WHERE company_id LIKE 'ZZTEST%';
DELETE FROM price_book_items    WHERE company_id LIKE 'ZZTEST%';
DELETE FROM price_book_package_items
  WHERE package_id IN (SELECT id FROM price_book_packages WHERE company_id LIKE 'ZZTEST%');
DELETE FROM price_book_packages WHERE company_id LIKE 'ZZTEST%';

-- Companies last
DELETE FROM companies WHERE id LIKE 'ZZTEST%';

COMMIT;

-- Verification: should all return 0
SELECT COUNT(*) AS zztest_companies FROM companies WHERE id LIKE 'ZZTEST%';
SELECT COUNT(*) AS zztest_users FROM users WHERE company_id LIKE 'ZZTEST%';
SELECT COUNT(*) AS zztest_pins FROM pins WHERE company_id LIKE 'ZZTEST%';
