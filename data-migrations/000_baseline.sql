-- 000_baseline.sql
-- Generated: 2026-08-11 from live database via pg_dump --schema-only --no-owner --no-acl --no-comments
--
-- PURPOSE: Bootstrap a fresh database to the exact state of the live schema as of the
-- permission-system close-out. Use this instead of drizzle-kit push (which requires an
-- interactive TTY and cannot run on merge).
--
-- This file was captured with:
--   pg_dump --schema-only --no-owner --no-acl --no-comments "$DATABASE_URL"
-- It includes all tables, columns with correct types and defaults, foreign keys,
-- non-partial and partial indexes (predicates included), views, and functions.
-- Drizzle-generated SQL was not used because it omits objects created by pre-baseline
-- migrations (non-partial indexes, view, function) and drifts from live column types.
--
-- FRESH DATABASE SETUP ORDER (see data-migrations/README.md for details):
--   1. psql "$DATABASE_URL" -f data-migrations/000_baseline.sql
--   2. Apply migrations 041–052 in order (all idempotent; safe to run against a baseline DB)
--      psql "$DATABASE_URL" -f data-migrations/041_approved_carrier_estimate.sql
--      ... (through 052_stage_transitions.sql)
--
-- DO NOT run migrations 001–040 against a database provisioned from this baseline.
-- Those migrations are embedded in the baseline snapshot.
--
-- VERIFICATION: Provisioning a scratch database with this file + migrations 041–052
-- and diffing its pg_dump against the live database produced zero differences
-- (only Replit mTLS session tokens differ, which are connection-level noise).
--
--
-- PostgreSQL database dump
--

\restrict 4rGiR8xhZ9lobjXz52oUw6lqeO80csxTxlCB4UHsOmlaL7ZNR0yEfKK6N8uRK3g

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: _parse_legacy_money_cents(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._parse_legacy_money_cents(raw text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT
    CASE
      WHEN raw IS NULL OR TRIM(raw) = '' THEN NULL
      WHEN stripped ~ '^[0-9]+(\.[0-9]+)?$' AND ROUND(stripped::numeric * 100) > 0
      THEN ROUND(stripped::numeric * 100)::integer
      ELSE NULL
    END
  FROM (
    SELECT REGEXP_REPLACE(TRIM(raw), '[$,\s]', '', 'g') AS stripped
  ) t
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_prompts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    agent_key character varying NOT NULL,
    system_prompt text NOT NULL,
    updated_by character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ahj_candidate_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ahj_candidate_items (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    wizard_run_id character varying NOT NULL,
    pack_type character varying NOT NULL,
    jurisdiction text NOT NULL,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    candidate_key text NOT NULL,
    citation text,
    edition text,
    provision_summary text,
    classification character varying NOT NULL,
    factual_trigger jsonb DEFAULT '{}'::jsonb NOT NULL,
    scope_connection text,
    source_locator jsonb DEFAULT '{}'::jsonb NOT NULL,
    amendment_note text,
    confidence double precision,
    gaps_context jsonb,
    lint_note text,
    verified_by character varying,
    verified_at timestamp with time zone,
    edit_diff jsonb,
    rejection_reason text,
    category text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    material_applicability jsonb DEFAULT '["all"]'::jsonb NOT NULL,
    needs_material_review boolean DEFAULT false NOT NULL
);


--
-- Name: ahj_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ahj_packs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pack_type character varying NOT NULL,
    jurisdiction text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying
);


--
-- Name: attestations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attestations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    user_id character varying NOT NULL,
    stage character varying,
    signature_data text,
    attested_at timestamp with time zone DEFAULT now() NOT NULL,
    attestation_type character varying,
    details jsonb
);


--
-- Name: boilerplate_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boilerplate_sections (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    section_key character varying NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying
);


--
-- Name: bug_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bug_reports (
    id character varying NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    route character varying NOT NULL,
    route_params jsonb,
    severity character varying NOT NULL,
    description text NOT NULL,
    context jsonb NOT NULL,
    screenshot_url text,
    app_version character varying,
    platform character varying,
    os_version character varying,
    status character varying DEFAULT 'new'::character varying NOT NULL,
    internal_note text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: canvassing_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvassing_sessions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


--
-- Name: change_order_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_order_line_items (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    change_order_id character varying NOT NULL,
    description text NOT NULL,
    quantity numeric(10,4) DEFAULT 1 NOT NULL,
    unit_price_cents integer NOT NULL,
    total_cents integer NOT NULL,
    price_book_item_id character varying,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: change_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_orders (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    description text NOT NULL,
    amount_cents integer NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    approved_at timestamp with time zone,
    created_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    required_to_complete_scope boolean DEFAULT false NOT NULL,
    document_object_path text,
    document_sha256 text,
    homeowner_signature_path text,
    homeowner_signed_at timestamp with time zone,
    rep_signature_path text,
    rep_signed_at timestamp with time zone,
    voided_at timestamp with time zone,
    voided_by_user_id character varying,
    void_reason text,
    emailed_at timestamp with time zone,
    carrier_reimbursable boolean DEFAULT false NOT NULL
);


--
-- Name: claim_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_events (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    event_type character varying NOT NULL,
    payload jsonb,
    actor_id character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_sections (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    section_type character varying NOT NULL,
    state character varying DEFAULT 'not_started'::character varying NOT NULL,
    content_html text,
    lint_status character varying,
    lint_findings jsonb,
    gate_flags jsonb,
    generated_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by character varying,
    library_version_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    staled_by character varying(100),
    supplement_id character varying
);


--
-- Name: claim_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_status_history (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    from_status character varying,
    to_status character varying,
    changed_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_supplements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_supplements (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    supplement_number text NOT NULL,
    supplement_reason character varying NOT NULL,
    compiled_report_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    original_package_blob_version text,
    original_attestation_id text,
    legacy_inline_supplement boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying
);


--
-- Name: code_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_sources (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    jurisdiction text NOT NULL,
    title text NOT NULL,
    edition text NOT NULL,
    effective_date text,
    source_url text,
    acquisition_basis character varying NOT NULL,
    licensing_note text NOT NULL,
    stored_corpus boolean DEFAULT false NOT NULL,
    accessed_at timestamp with time zone,
    created_by character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id character varying NOT NULL,
    name character varying NOT NULL,
    founder_user_id character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    beta_bug_reporting boolean DEFAULT true NOT NULL,
    logo_url character varying,
    ai_settings jsonb DEFAULT 'null'::jsonb,
    report_branding jsonb DEFAULT 'null'::jsonb,
    contractor_legal_name character varying,
    contractor_address character varying,
    fipsa_fee_cents integer,
    contractor_licenses jsonb DEFAULT 'null'::jsonb,
    qualifications_text character varying,
    pricing_basis_statement character varying,
    lead_sources jsonb
);


--
-- Name: company_crm_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_crm_config (
    company_id character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    field_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_jurisdiction_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_jurisdiction_packs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    jurisdiction character varying(120) NOT NULL,
    state character varying(2) NOT NULL,
    opening_statements jsonb DEFAULT '[]'::jsonb NOT NULL,
    uppa_law character varying,
    uppa_statement character varying,
    general_code_citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    roofing_code_citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    siding_code_citations jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_templates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name text NOT NULL,
    object_path text NOT NULL,
    mime_type text NOT NULL,
    use_case text NOT NULL,
    original_filename text NOT NULL,
    uploaded_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comparison_set_captions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comparison_set_captions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    comparison_pair_id character varying NOT NULL,
    caption_text text,
    state character varying DEFAULT 'pending'::character varying NOT NULL,
    generated_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: completion_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.completion_certificates (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    contract_id character varying,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    document_object_path text,
    document_sha256 text,
    signed_by_user_id character varying,
    signed_at timestamp with time zone,
    signer_title text,
    line_items jsonb,
    created_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_scope_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_scope_packages (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    contract_id character varying NOT NULL,
    category_id character varying NOT NULL,
    quantity numeric NOT NULL,
    unit character varying NOT NULL,
    covered_amount_cents integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: contract_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_selections (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    contract_id character varying NOT NULL,
    scope_package_id character varying NOT NULL,
    product_id character varying NOT NULL,
    option_id character varying,
    product_name character varying NOT NULL,
    brand_name character varying NOT NULL,
    option_name character varying,
    unit_delta_cents integer NOT NULL,
    quantity numeric NOT NULL,
    extended_delta_cents integer NOT NULL,
    selected_by character varying NOT NULL,
    selected_by_user_id character varying,
    selected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    access_code character varying NOT NULL,
    access_code_expires_at timestamp with time zone,
    status character varying DEFAULT 'draft'::character varying NOT NULL,
    sent_at timestamp with time zone,
    covered_scope_cents integer DEFAULT 0 NOT NULL,
    betterments_cents integer DEFAULT 0 NOT NULL,
    deductible_cents integer DEFAULT 0 NOT NULL,
    total_contract_cents integer DEFAULT 0 NOT NULL,
    scope_summary text,
    scope_source character varying,
    template_id character varying,
    document_object_path text,
    document_sha256 text,
    customer_signature_path text,
    customer_signed_at timestamp with time zone,
    customer_print_name character varying,
    rep_signature_path text,
    rep_signed_at timestamp with time zone,
    voided_at timestamp with time zone,
    voided_by_user_id character varying,
    void_reason text,
    created_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: corpus_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corpus_chunks (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    code_source_id character varying NOT NULL,
    company_id character varying NOT NULL,
    section_id text NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_invoices (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    invoice_number character varying NOT NULL,
    customer_name character varying NOT NULL,
    customer_address text NOT NULL,
    invoice_type character varying NOT NULL,
    amount_cents integer NOT NULL,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    notes text,
    pdf_url text,
    sent_date timestamp with time zone,
    paid_date timestamp with time zone,
    payment_method character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: damage_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.damage_instances (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    slope_id character varying,
    elevation_id character varying,
    damage_type text NOT NULL,
    severity text,
    causation_note text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deactivation_sweep_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deactivation_sweep_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    company_id character varying NOT NULL,
    deactivated_at timestamp with time zone NOT NULL,
    days_since integer NOT NULL,
    action_taken character varying NOT NULL,
    blocked_reason text,
    detail jsonb,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: detriment_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detriment_entries (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    entry_key character varying NOT NULL,
    applicability_conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    statement text DEFAULT ''::text NOT NULL,
    required_support text,
    limitation text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying
);


--
-- Name: discontinued_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discontinued_products (
    id character varying NOT NULL,
    company_id character varying NOT NULL,
    name character varying(200) NOT NULL,
    photo_path text,
    width_inches double precision,
    exposure_inches double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exhibit_captions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exhibit_captions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    exhibit_selection_id character varying NOT NULL,
    badge_label character varying NOT NULL,
    caption_text text,
    state character varying DEFAULT 'pending'::character varying NOT NULL,
    generated_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_addenda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_addenda (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    user_id character varying NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_comparison_pairs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_comparison_pairs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    before_photo_id character varying NOT NULL,
    after_photo_id character varying NOT NULL,
    pair_type character varying NOT NULL,
    confirmed_by character varying,
    confirmed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_components (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    slope_id character varying,
    component_type character varying NOT NULL,
    status character varying,
    layer_count double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_elevations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_elevations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    direction character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_exhibit_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_exhibit_selections (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    photo_id character varying NOT NULL,
    exhibit_class character varying,
    badge_label character varying,
    sort_order integer DEFAULT 0 NOT NULL,
    is_ai_proposed boolean DEFAULT false NOT NULL,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_interior_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_interior_observations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    location text NOT NULL,
    observation_type character varying NOT NULL,
    moisture_reading double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_penetrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_penetrations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    slope_id character varying,
    penetration_type character varying NOT NULL,
    flashing_condition text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_photos (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    stage character varying,
    subject_type character varying NOT NULL,
    subject_id character varying,
    triad_role character varying,
    url text NOT NULL,
    sha256 text NOT NULL,
    exif_json jsonb,
    overlay_json jsonb,
    captured_at_utc timestamp with time zone,
    latitude double precision,
    longitude double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preliminary_role character varying,
    zone character varying,
    siding_role character varying,
    siding_component_index integer,
    include_in_proof_package boolean DEFAULT true NOT NULL
);


--
-- Name: inspection_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_products (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    slope_id character varying,
    category text,
    brand text,
    product_line text,
    identification_method character varying NOT NULL,
    itel_sample_ref text,
    unidentifiable_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    discontinued character varying,
    ordinary_availability character varying
);


--
-- Name: inspection_siding_facets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_siding_facets (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    label text NOT NULL,
    damaged boolean DEFAULT false NOT NULL,
    damage_type character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    wrb_present boolean,
    components jsonb DEFAULT '[]'::jsonb NOT NULL,
    isolated boolean,
    area_sqft real,
    pre_existing_conditions jsonb DEFAULT '[]'::jsonb
);


--
-- Name: inspection_slopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_slopes (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    label text NOT NULL,
    pitch_rise double precision,
    pitch_run double precision,
    material_type text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    area_sqft double precision,
    damage_type character varying,
    damage_present boolean DEFAULT false NOT NULL,
    tie_in_valley boolean DEFAULT false NOT NULL,
    tie_in_hip_ridge boolean DEFAULT false NOT NULL,
    compass_bearing double precision
);


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspections (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying,
    inspector_user_id character varying NOT NULL,
    status character varying DEFAULT 'scheduled'::character varying NOT NULL,
    claim_number text,
    policy_number text,
    carrier_name text,
    insured_name text,
    address text,
    latitude double precision,
    longitude double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    date_of_loss text,
    storm_confirmed_ref jsonb,
    arrival_conditions jsonb,
    homeowner_facts jsonb,
    submission_manifest jsonb,
    locked_at timestamp with time zone,
    phase character varying DEFAULT 'forensic'::character varying NOT NULL,
    damage_type text,
    preliminary_completed_at timestamp with time zone,
    roof_damage_found boolean DEFAULT false NOT NULL,
    siding_damage_found boolean DEFAULT false NOT NULL,
    collateral_damage_found boolean DEFAULT false NOT NULL,
    siding_measurement_report_ref text,
    damage_surface_change_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    siding_wrb_present boolean,
    interior_damage_found boolean DEFAULT false NOT NULL,
    property_profile jsonb,
    repairability_assessment jsonb,
    existing_or_unrelated_conditions jsonb,
    temporary_repairs jsonb,
    property_protection_plan jsonb,
    owner_email text,
    scheduled_for timestamp with time zone,
    ai_summary jsonb DEFAULT 'null'::jsonb,
    compiled_report_path text,
    compiled_report_ready_at timestamp with time zone,
    estimate jsonb DEFAULT 'null'::jsonb,
    compiled_report_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
    report_lint_resolution jsonb DEFAULT 'null'::jsonb,
    unlock_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    portal_access_code text,
    portal_access_revoked_at timestamp with time zone,
    measurements_report_url text,
    rap_gate_reason character varying,
    trigger_flags jsonb,
    exhibit_badge_map jsonb,
    facet_inventory jsonb,
    facet_count integer,
    facet_inventory_status text,
    ahj_check jsonb
);


--
-- Name: lead_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_files (
    id character varying NOT NULL,
    pin_id character varying NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    object_path text NOT NULL,
    file_name character varying(500) NOT NULL,
    original_name character varying(500) NOT NULL,
    file_size integer DEFAULT 0 NOT NULL,
    mime_type character varying(200) DEFAULT ''::character varying NOT NULL,
    category character varying DEFAULT 'other'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.measurements (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    subject_type character varying NOT NULL,
    subject_id character varying,
    measurement_type text NOT NULL,
    value double precision NOT NULL,
    unit text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    notification_type character varying NOT NULL,
    email_enabled boolean NOT NULL,
    push_enabled boolean NOT NULL,
    frequency character varying DEFAULT 'immediate'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: object_ownership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_ownership (
    object_path character varying NOT NULL,
    user_id character varying NOT NULL,
    company_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    type character varying NOT NULL,
    amount_cents integer NOT NULL,
    method character varying,
    payment_date timestamp with time zone NOT NULL,
    notes text,
    customer_invoice_id character varying,
    created_by_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permission_override_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_override_changes (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    target_user_id character varying NOT NULL,
    permission character varying(100) NOT NULL,
    previous_state character varying(10),
    new_state character varying(10),
    note text NOT NULL,
    actor_user_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pin_financial_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pin_financial_changes (
    id character varying DEFAULT (gen_random_uuid())::text NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    changed_by_user_id character varying NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    CONSTRAINT pin_financial_changes_field_check CHECK ((field = ANY (ARRAY['contract_amount'::text, 'deductible_amount'::text, 'rcv_amount'::text])))
);


--
-- Name: pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pins (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    address text,
    workflow character varying NOT NULL,
    damage_type character varying,
    photo_url text,
    door_knock_result character varying,
    retail_data jsonb,
    status character varying DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_outcome character varying,
    customer_name text,
    customer_phone text,
    company_id character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_first_name text,
    owner_last_name text,
    owner_email text,
    owner2_first_name text,
    owner2_last_name text,
    notes text,
    pipeline_stage character varying,
    insurance_carrier character varying,
    policy_number character varying,
    claim_number character varying,
    date_of_loss timestamp with time zone,
    inspection_date timestamp with time zone,
    adjuster_name character varying,
    adjuster_phone character varying,
    adjuster_email character varying,
    adjuster_meeting_date timestamp with time zone,
    contract_amount character varying,
    deposit_amount character varying,
    deposit_date timestamp with time zone,
    deposit_payment_method character varying,
    deductible_amount character varying,
    rcv_amount character varying,
    acv_amount character varying,
    supplement_amount character varying,
    final_payment_amount character varying,
    contract_scope text,
    square_footage character varying,
    roof_pitch character varying,
    measurement_vendor character varying,
    measurement_report_url text,
    material_brand character varying,
    material_color character varying,
    material_style character varying,
    profile_status character varying,
    status_notes text,
    status_last_updated timestamp with time zone,
    non_owner_occupied boolean DEFAULT false,
    mailing_address text,
    mailing_city character varying,
    mailing_state character varying,
    mailing_zip character varying,
    mailer_sent_date timestamp with time zone,
    claim_filed_date timestamp with time zone,
    policy_holder character varying,
    coverage_type character varying,
    approved_rcv_amount character varying,
    approved_acv_amount character varying,
    depreciation_amount character varying,
    inspection_notes text,
    stage_entered_at timestamp with time zone,
    loop_next_action_at timestamp with time zone,
    loss_reason character varying,
    source_pipeline character varying,
    is_demo boolean DEFAULT false NOT NULL,
    needs_stage_review boolean DEFAULT false NOT NULL,
    external_lead_source character varying,
    project_manager_name character varying,
    lead_acquisition_cost_cents integer,
    referral_fee_cents integer,
    sales_commission_cents integer,
    sales_commission_paid_date timestamp with time zone,
    pm_commission_cents integer,
    pm_commission_paid_date timestamp with time zone,
    canvassing_commission_cents integer,
    canvassing_commission_paid_date timestamp with time zone,
    referral_fee_paid_date timestamp with time zone,
    lead_acquisition_paid_date timestamp with time zone,
    claim_status character varying,
    adjuster_last_contact timestamp with time zone,
    betterments_amount_cents integer,
    supplement_notes text,
    appointment_at timestamp with time zone,
    appointment_assigned_to character varying,
    appointment_status character varying,
    approved_estimate_object_path text,
    approved_estimate_sha256 text
);


--
-- Name: vendor_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_expenses (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    pin_id character varying NOT NULL,
    vendor_name character varying NOT NULL,
    invoice_number character varying,
    invoice_date timestamp with time zone,
    amount_cents integer NOT NULL,
    category character varying NOT NULL,
    description text,
    document_url text,
    is_paid boolean DEFAULT false NOT NULL,
    paid_date timestamp with time zone,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pin_profitability; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pin_profitability AS
 WITH agg AS (
         SELECT p.id AS pin_id,
            p.company_id,
            p.workflow,
            COALESCE(pay_agg.total_payments_cents, (0)::bigint) AS total_payments_cents,
            COALESCE(inv_agg.invoice_total_cents, (0)::bigint) AS invoice_total_cents,
            COALESCE(inv_agg.invoice_paid_cents, (0)::bigint) AS invoice_paid_cents,
            COALESCE(exp_agg.total_expense_cents, (0)::bigint) AS total_expense_cents,
            COALESCE(exp_agg.paid_expense_cents, (0)::bigint) AS paid_expense_cents,
            COALESCE(exp_agg.outstanding_expense_cents, (0)::bigint) AS outstanding_expense_cents,
            COALESCE(p.lead_acquisition_cost_cents, 0) AS lead_acquisition_cost_cents,
            COALESCE(p.referral_fee_cents, 0) AS referral_fee_cents,
            COALESCE(p.sales_commission_cents, 0) AS sales_commission_cents,
            COALESCE(p.pm_commission_cents, 0) AS pm_commission_cents,
            COALESCE(p.canvassing_commission_cents, 0) AS canvassing_commission_cents,
            COALESCE(co_agg.approved_co_cents, (0)::bigint) AS approved_co_cents,
            COALESCE(public._parse_legacy_money_cents((p.contract_amount)::text), 0) AS base_contract_cents,
            COALESCE(public._parse_legacy_money_cents((p.approved_rcv_amount)::text), 0) AS approved_rcv_cents,
            COALESCE(public._parse_legacy_money_cents((p.approved_acv_amount)::text), 0) AS approved_acv_cents,
            COALESCE(public._parse_legacy_money_cents((p.deductible_amount)::text), 0) AS policy_deductible_cents,
            COALESCE(p.betterments_amount_cents, 0) AS betterments_amount_cents,
            COALESCE(deduct_agg.deductible_collected_cents, (0)::bigint) AS deductible_collected_cents,
            COALESCE(supp_agg.supplement_candidate_cents, (0)::bigint) AS supplement_candidate_cents
           FROM ((((((public.pins p
             LEFT JOIN ( SELECT payments.pin_id,
                    sum(payments.amount_cents) AS total_payments_cents
                   FROM public.payments
                  GROUP BY payments.pin_id) pay_agg ON (((pay_agg.pin_id)::text = (p.id)::text)))
             LEFT JOIN ( SELECT customer_invoices.pin_id,
                    sum(customer_invoices.amount_cents) AS invoice_total_cents,
                    sum(customer_invoices.amount_cents) FILTER (WHERE ((customer_invoices.status)::text = 'paid'::text)) AS invoice_paid_cents
                   FROM public.customer_invoices
                  WHERE ((customer_invoices.status)::text <> 'void'::text)
                  GROUP BY customer_invoices.pin_id) inv_agg ON (((inv_agg.pin_id)::text = (p.id)::text)))
             LEFT JOIN ( SELECT vendor_expenses.pin_id,
                    sum(vendor_expenses.amount_cents) AS total_expense_cents,
                    sum(vendor_expenses.amount_cents) FILTER (WHERE (vendor_expenses.is_paid = true)) AS paid_expense_cents,
                    sum(vendor_expenses.amount_cents) FILTER (WHERE (vendor_expenses.is_paid = false)) AS outstanding_expense_cents
                   FROM public.vendor_expenses
                  GROUP BY vendor_expenses.pin_id) exp_agg ON (((exp_agg.pin_id)::text = (p.id)::text)))
             LEFT JOIN ( SELECT change_orders.pin_id,
                    sum(change_orders.amount_cents) AS approved_co_cents
                   FROM public.change_orders
                  WHERE (((change_orders.status)::text = 'approved'::text) AND (change_orders.voided_at IS NULL))
                  GROUP BY change_orders.pin_id) co_agg ON (((co_agg.pin_id)::text = (p.id)::text)))
             LEFT JOIN ( SELECT payments.pin_id,
                    sum(payments.amount_cents) AS deductible_collected_cents
                   FROM public.payments
                  WHERE ((payments.type)::text = 'deductible'::text)
                  GROUP BY payments.pin_id) deduct_agg ON (((deduct_agg.pin_id)::text = (p.id)::text)))
             LEFT JOIN ( SELECT change_orders.pin_id,
                    sum(change_orders.amount_cents) AS supplement_candidate_cents
                   FROM public.change_orders
                  WHERE (((change_orders.status)::text = 'approved'::text) AND (change_orders.voided_at IS NULL) AND (change_orders.required_to_complete_scope = true))
                  GROUP BY change_orders.pin_id) supp_agg ON (((supp_agg.pin_id)::text = (p.id)::text)))
        ), calc AS (
         SELECT agg.pin_id,
            agg.company_id,
            agg.workflow,
            agg.total_payments_cents,
            agg.invoice_total_cents,
            agg.invoice_paid_cents,
            agg.total_expense_cents,
            agg.paid_expense_cents,
            agg.outstanding_expense_cents,
            agg.lead_acquisition_cost_cents,
            agg.referral_fee_cents,
            agg.sales_commission_cents,
            agg.pm_commission_cents,
            agg.canvassing_commission_cents,
            agg.approved_co_cents,
            agg.base_contract_cents,
            agg.approved_rcv_cents,
            agg.approved_acv_cents,
            agg.policy_deductible_cents,
            agg.betterments_amount_cents,
            agg.deductible_collected_cents,
            agg.supplement_candidate_cents,
            ((((agg.lead_acquisition_cost_cents + agg.referral_fee_cents) + agg.sales_commission_cents) + agg.pm_commission_cents) + agg.canvassing_commission_cents) AS total_commission_cents,
            (((((agg.total_expense_cents + agg.lead_acquisition_cost_cents) + agg.referral_fee_cents) + agg.sales_commission_cents) + agg.pm_commission_cents) + agg.canvassing_commission_cents) AS total_cost_cents,
            (agg.base_contract_cents + agg.approved_co_cents) AS revised_contract_cents
           FROM agg
        ), final AS (
         SELECT calc.pin_id,
            calc.company_id,
            calc.workflow,
            calc.total_payments_cents,
            calc.invoice_total_cents,
            calc.invoice_paid_cents,
            calc.total_expense_cents,
            calc.paid_expense_cents,
            calc.outstanding_expense_cents,
            calc.lead_acquisition_cost_cents,
            calc.referral_fee_cents,
            calc.sales_commission_cents,
            calc.pm_commission_cents,
            calc.canvassing_commission_cents,
            calc.approved_co_cents,
            calc.base_contract_cents,
            calc.approved_rcv_cents,
            calc.approved_acv_cents,
            calc.policy_deductible_cents,
            calc.betterments_amount_cents,
            calc.deductible_collected_cents,
            calc.supplement_candidate_cents,
            calc.total_commission_cents,
            calc.total_cost_cents,
            calc.revised_contract_cents,
            (
                CASE
                    WHEN ((calc.workflow)::text = 'insurance'::text) THEN GREATEST(calc.revised_contract_cents, (calc.approved_rcv_cents)::bigint)
                    ELSE calc.revised_contract_cents
                END)::integer AS expected_total_cents
           FROM calc
        )
 SELECT pin_id,
    company_id,
    total_payments_cents,
    invoice_total_cents,
    invoice_paid_cents,
    total_expense_cents,
    paid_expense_cents,
    outstanding_expense_cents,
    lead_acquisition_cost_cents,
    referral_fee_cents,
    sales_commission_cents,
    pm_commission_cents,
    total_commission_cents,
    total_cost_cents,
    (total_payments_cents - total_cost_cents) AS net_profit_cents,
    expected_total_cents,
        CASE
            WHEN (total_payments_cents > 0) THEN ((((total_payments_cents - total_cost_cents))::numeric / (total_payments_cents)::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS cash_margin_pct,
        CASE
            WHEN (expected_total_cents > 0) THEN ((((expected_total_cents - total_cost_cents))::numeric / (expected_total_cents)::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS projected_margin_pct,
    canvassing_commission_cents,
    approved_co_cents,
    revised_contract_cents,
    (revised_contract_cents - total_cost_cents) AS net_project_margin_cents,
        CASE
            WHEN (revised_contract_cents > 0) THEN ((((revised_contract_cents - total_cost_cents))::numeric / (revised_contract_cents)::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS net_project_margin_pct,
    deductible_collected_cents,
    policy_deductible_cents,
    approved_acv_cents,
    supplement_candidate_cents,
    (approved_rcv_cents - approved_acv_cents) AS depreciation_cents,
    (approved_rcv_cents - revised_contract_cents) AS claim_variance_cents,
    (revised_contract_cents - betterments_amount_cents) AS base_scope_cents
   FROM final;


--
-- Name: price_book_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_book_items (
    id character varying NOT NULL,
    company_id character varying NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    unit_price integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unit character varying(60)
);


--
-- Name: price_book_package_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_book_package_items (
    package_id character varying NOT NULL,
    item_id character varying NOT NULL,
    quantity integer DEFAULT 1 NOT NULL
);


--
-- Name: price_book_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_book_packages (
    id character varying NOT NULL,
    company_id character varying NOT NULL,
    name character varying(200) NOT NULL,
    inspection_condition character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_attestations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_attestations (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    preparer_id character varying NOT NULL,
    prepared_at timestamp with time zone DEFAULT now() NOT NULL,
    blob_version_index integer NOT NULL,
    statement_hash character varying(64) NOT NULL,
    statement_text text NOT NULL,
    attestation_block_key character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplement_id character varying
);


--
-- Name: roof_facets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roof_facets (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    inspection_id character varying NOT NULL,
    facet_id text NOT NULL,
    area_sq_ft real NOT NULL,
    pitch text NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: selection_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_brands (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    category_id character varying NOT NULL,
    name character varying(120) NOT NULL,
    logo_path text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: selection_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_categories (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(80) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: selection_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_options (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    brand_id character varying NOT NULL,
    name character varying(120) NOT NULL,
    option_group character varying(80),
    swatch_hex character varying(7),
    swatch_image_path text,
    hoa_compliant boolean,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: selection_product_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_product_options (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    product_id character varying NOT NULL,
    option_id character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: selection_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selection_products (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    category_id character varying NOT NULL,
    brand_id character varying NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    specs jsonb,
    is_base boolean DEFAULT false NOT NULL,
    price_delta_cents integer DEFAULT 0 NOT NULL,
    unit character varying(60) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


--
-- Name: signed_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signed_agreements (
    id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    company_id character varying NOT NULL,
    signer_name text NOT NULL,
    document_version character varying(20) NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    audit_metadata jsonb NOT NULL,
    document_object_path text NOT NULL,
    voided_at timestamp with time zone,
    voided_by_user_id character varying,
    void_reason text,
    emailed_at timestamp with time zone
);


--
-- Name: stage_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_transitions (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    lead_id character varying NOT NULL,
    from_stage character varying,
    to_stage character varying NOT NULL,
    trigger character varying NOT NULL,
    task_payload jsonb,
    user_id character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: standards_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.standards_entries (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    entry_key character varying NOT NULL,
    source_type character varying,
    citation_text text,
    verification_status character varying DEFAULT 'verify_before_ship'::character varying NOT NULL,
    verified_at timestamp with time zone,
    authority_limit text,
    locator_template text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying,
    human_entered_provisions_only boolean DEFAULT false NOT NULL,
    title text
);


--
-- Name: test_square_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_square_hits (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    test_square_id character varying NOT NULL,
    hit_type text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: test_squares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_squares (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    inspection_id character varying NOT NULL,
    slope_id character varying,
    label text NOT NULL,
    size_sq_ft double precision,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_locations (
    user_id character varying NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id character varying NOT NULL
);


--
-- Name: user_permission_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permission_overrides (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    permission character varying(100) NOT NULL,
    granted boolean NOT NULL,
    granted_by_user_id character varying NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    user_id character varying NOT NULL,
    role character varying DEFAULT 'field_rep'::character varying NOT NULL,
    workflow_assignment character varying DEFAULT 'insurance_retail'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department character varying DEFAULT 'canvasser'::character varying NOT NULL,
    signature_url text,
    signature_sha256 text,
    signature_signed_at timestamp with time zone,
    smtp_host text,
    smtp_port integer,
    smtp_secure boolean,
    smtp_username text,
    smtp_password_enc text,
    smtp_from_email text,
    certifications jsonb,
    years_experience integer,
    phone text,
    theme character varying(10) DEFAULT 'dark'::character varying NOT NULL,
    dashboard_layout jsonb,
    title text,
    manager_user_id character varying,
    CONSTRAINT user_profiles_theme_check CHECK (((theme)::text = ANY ((ARRAY['light'::character varying, 'dark'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: user_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_push_tokens (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    user_id character varying NOT NULL,
    expo_push_token character varying NOT NULL,
    device_label character varying,
    platform character varying,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email character varying,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id character varying NOT NULL,
    deactivated_at timestamp with time zone,
    pii_purged_at timestamp with time zone
);


--
-- Name: wizard_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wizard_runs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    company_id character varying NOT NULL,
    jurisdiction text NOT NULL,
    pack_type character varying NOT NULL,
    code_source_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    prompt_version text NOT NULL,
    model text DEFAULT 'gemini-2.5-flash'::text NOT NULL,
    category_sweep jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying DEFAULT 'running'::character varying NOT NULL,
    created_by character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_prompts agent_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompts
    ADD CONSTRAINT agent_prompts_pkey PRIMARY KEY (id);


--
-- Name: ahj_candidate_items ahj_candidate_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_candidate_items
    ADD CONSTRAINT ahj_candidate_items_pkey PRIMARY KEY (id);


--
-- Name: ahj_packs ahj_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_packs
    ADD CONSTRAINT ahj_packs_pkey PRIMARY KEY (id);


--
-- Name: attestations attestations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestations
    ADD CONSTRAINT attestations_pkey PRIMARY KEY (id);


--
-- Name: boilerplate_sections boilerplate_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boilerplate_sections
    ADD CONSTRAINT boilerplate_sections_pkey PRIMARY KEY (id);


--
-- Name: bug_reports bug_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_pkey PRIMARY KEY (id);


--
-- Name: canvassing_sessions canvassing_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvassing_sessions
    ADD CONSTRAINT canvassing_sessions_pkey PRIMARY KEY (id);


--
-- Name: change_order_line_items change_order_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_pkey PRIMARY KEY (id);


--
-- Name: change_orders change_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_pkey PRIMARY KEY (id);


--
-- Name: claim_events claim_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_events
    ADD CONSTRAINT claim_events_pkey PRIMARY KEY (id);


--
-- Name: claim_sections claim_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_pkey PRIMARY KEY (id);


--
-- Name: claim_status_history claim_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_pkey PRIMARY KEY (id);


--
-- Name: claim_supplements claim_supplements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_pkey PRIMARY KEY (id);


--
-- Name: code_sources code_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_sources
    ADD CONSTRAINT code_sources_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_crm_config company_crm_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_crm_config
    ADD CONSTRAINT company_crm_config_pkey PRIMARY KEY (company_id);


--
-- Name: company_jurisdiction_packs company_jurisdiction_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_jurisdiction_packs
    ADD CONSTRAINT company_jurisdiction_packs_pkey PRIMARY KEY (id);


--
-- Name: company_templates company_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_pkey PRIMARY KEY (id);


--
-- Name: comparison_set_captions comparison_set_captions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_pkey PRIMARY KEY (id);


--
-- Name: completion_certificates completion_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_pkey PRIMARY KEY (id);


--
-- Name: contract_scope_packages contract_scope_packages_contract_id_category_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_contract_id_category_id_key UNIQUE (contract_id, category_id);


--
-- Name: contract_scope_packages contract_scope_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_pkey PRIMARY KEY (id);


--
-- Name: contract_selections contract_selections_contract_id_scope_package_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_contract_id_scope_package_id_key UNIQUE (contract_id, scope_package_id);


--
-- Name: contract_selections contract_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: corpus_chunks corpus_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_chunks
    ADD CONSTRAINT corpus_chunks_pkey PRIMARY KEY (id);


--
-- Name: customer_invoices customer_invoices_company_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_company_number_unique UNIQUE (company_id, invoice_number);


--
-- Name: customer_invoices customer_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_pkey PRIMARY KEY (id);


--
-- Name: damage_instances damage_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_instances
    ADD CONSTRAINT damage_instances_pkey PRIMARY KEY (id);


--
-- Name: deactivation_sweep_log deactivation_sweep_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deactivation_sweep_log
    ADD CONSTRAINT deactivation_sweep_log_pkey PRIMARY KEY (id);


--
-- Name: detriment_entries detriment_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detriment_entries
    ADD CONSTRAINT detriment_entries_pkey PRIMARY KEY (id);


--
-- Name: discontinued_products discontinued_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discontinued_products
    ADD CONSTRAINT discontinued_products_pkey PRIMARY KEY (id);


--
-- Name: exhibit_captions exhibit_captions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit_captions
    ADD CONSTRAINT exhibit_captions_pkey PRIMARY KEY (id);


--
-- Name: inspection_addenda inspection_addenda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_addenda
    ADD CONSTRAINT inspection_addenda_pkey PRIMARY KEY (id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_pkey PRIMARY KEY (id);


--
-- Name: inspection_components inspection_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_components
    ADD CONSTRAINT inspection_components_pkey PRIMARY KEY (id);


--
-- Name: inspection_elevations inspection_elevations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_elevations
    ADD CONSTRAINT inspection_elevations_pkey PRIMARY KEY (id);


--
-- Name: inspection_exhibit_selections inspection_exhibit_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_exhibit_selections
    ADD CONSTRAINT inspection_exhibit_selections_pkey PRIMARY KEY (id);


--
-- Name: inspection_interior_observations inspection_interior_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_interior_observations
    ADD CONSTRAINT inspection_interior_observations_pkey PRIMARY KEY (id);


--
-- Name: inspection_penetrations inspection_penetrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_penetrations
    ADD CONSTRAINT inspection_penetrations_pkey PRIMARY KEY (id);


--
-- Name: inspection_photos inspection_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_photos
    ADD CONSTRAINT inspection_photos_pkey PRIMARY KEY (id);


--
-- Name: inspection_products inspection_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_products
    ADD CONSTRAINT inspection_products_pkey PRIMARY KEY (id);


--
-- Name: inspection_siding_facets inspection_siding_facets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_siding_facets
    ADD CONSTRAINT inspection_siding_facets_pkey PRIMARY KEY (id);


--
-- Name: inspection_slopes inspection_slopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_slopes
    ADD CONSTRAINT inspection_slopes_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_portal_access_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_portal_access_code_unique UNIQUE (portal_access_code);


--
-- Name: lead_files lead_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_files
    ADD CONSTRAINT lead_files_pkey PRIMARY KEY (id);


--
-- Name: measurements measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_user_id_notification_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_notification_type_key UNIQUE (user_id, notification_type);


--
-- Name: object_ownership object_ownership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_ownership
    ADD CONSTRAINT object_ownership_pkey PRIMARY KEY (object_path);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permission_override_changes permission_override_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_pkey PRIMARY KEY (id);


--
-- Name: pin_financial_changes pin_financial_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_pkey PRIMARY KEY (id);


--
-- Name: pins pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_pkey PRIMARY KEY (id);


--
-- Name: price_book_items price_book_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_items
    ADD CONSTRAINT price_book_items_pkey PRIMARY KEY (id);


--
-- Name: price_book_package_items price_book_package_items_package_id_item_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_package_items
    ADD CONSTRAINT price_book_package_items_package_id_item_id_pk PRIMARY KEY (package_id, item_id);


--
-- Name: price_book_packages price_book_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_packages
    ADD CONSTRAINT price_book_packages_pkey PRIMARY KEY (id);


--
-- Name: report_attestations report_attestations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_pkey PRIMARY KEY (id);


--
-- Name: roof_facets roof_facets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_facets
    ADD CONSTRAINT roof_facets_pkey PRIMARY KEY (id);


--
-- Name: selection_brands selection_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_brands
    ADD CONSTRAINT selection_brands_pkey PRIMARY KEY (id);


--
-- Name: selection_categories selection_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_categories
    ADD CONSTRAINT selection_categories_pkey PRIMARY KEY (id);


--
-- Name: selection_options selection_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_options
    ADD CONSTRAINT selection_options_pkey PRIMARY KEY (id);


--
-- Name: selection_product_options selection_product_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_pkey PRIMARY KEY (id);


--
-- Name: selection_product_options selection_product_options_product_id_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_product_id_option_id_key UNIQUE (product_id, option_id);


--
-- Name: selection_products selection_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: signed_agreements signed_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signed_agreements
    ADD CONSTRAINT signed_agreements_pkey PRIMARY KEY (id);


--
-- Name: stage_transitions stage_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transitions
    ADD CONSTRAINT stage_transitions_pkey PRIMARY KEY (id);


--
-- Name: standards_entries standards_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standards_entries
    ADD CONSTRAINT standards_entries_pkey PRIMARY KEY (id);


--
-- Name: test_square_hits test_square_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_square_hits
    ADD CONSTRAINT test_square_hits_pkey PRIMARY KEY (id);


--
-- Name: test_squares test_squares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_squares
    ADD CONSTRAINT test_squares_pkey PRIMARY KEY (id);


--
-- Name: user_locations user_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_pkey PRIMARY KEY (user_id);


--
-- Name: user_permission_overrides user_permission_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: user_push_tokens user_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: user_push_tokens user_push_tokens_token_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_token_uq UNIQUE (expo_push_token);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendor_expenses vendor_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_expenses
    ADD CONSTRAINT vendor_expenses_pkey PRIMARY KEY (id);


--
-- Name: wizard_runs wizard_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wizard_runs
    ADD CONSTRAINT wizard_runs_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: agent_prompts_company_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_prompts_company_key_uidx ON public.agent_prompts USING btree (company_id, agent_key);


--
-- Name: claim_sections_supplement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_sections_supplement_id_idx ON public.claim_sections USING btree (supplement_id);


--
-- Name: company_jurisdiction_packs_company_jurisdiction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_jurisdiction_packs_company_jurisdiction_idx ON public.company_jurisdiction_packs USING btree (company_id, jurisdiction);


--
-- Name: company_templates_company_use_case_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_templates_company_use_case_unique ON public.company_templates USING btree (company_id, use_case) WHERE (use_case <> 'other'::text);


--
-- Name: completion_certificates_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX completion_certificates_company_id_idx ON public.completion_certificates USING btree (company_id);


--
-- Name: completion_certificates_pin_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX completion_certificates_pin_id_idx ON public.completion_certificates USING btree (pin_id);


--
-- Name: contracts_access_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contracts_access_code_idx ON public.contracts USING btree (access_code);


--
-- Name: contracts_one_active_per_pin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contracts_one_active_per_pin_idx ON public.contracts USING btree (pin_id) WHERE (voided_at IS NULL);


--
-- Name: customer_invoices_company_pin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_invoices_company_pin_idx ON public.customer_invoices USING btree (company_id, pin_id);


--
-- Name: deactivation_sweep_log_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deactivation_sweep_log_blocked_idx ON public.deactivation_sweep_log USING btree (action_taken) WHERE ((action_taken)::text = 'blocked'::text);


--
-- Name: deactivation_sweep_log_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deactivation_sweep_log_user_id_idx ON public.deactivation_sweep_log USING btree (user_id, processed_at DESC);


--
-- Name: idx_change_orders_company_pin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_orders_company_pin ON public.change_orders USING btree (company_id, pin_id);


--
-- Name: idx_claim_status_history_company_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claim_status_history_company_created_at ON public.claim_status_history USING btree (company_id, created_at);


--
-- Name: idx_coli_change_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coli_change_order ON public.change_order_line_items USING btree (change_order_id);


--
-- Name: idx_coli_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coli_company ON public.change_order_line_items USING btree (company_id);


--
-- Name: idx_notification_preferences_company_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_preferences_company_type ON public.notification_preferences USING btree (company_id, notification_type);


--
-- Name: idx_notification_preferences_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_preferences_user_id ON public.notification_preferences USING btree (user_id);


--
-- Name: idx_pins_company_appointment_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pins_company_appointment_at ON public.pins USING btree (company_id, appointment_at) WHERE (appointment_at IS NOT NULL);


--
-- Name: idx_stage_transitions_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stage_transitions_lead_id ON public.stage_transitions USING btree (lead_id, created_at DESC);


--
-- Name: notification_prefs_user_type_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_prefs_user_type_uniq ON public.notification_preferences USING btree (user_id, notification_type);


--
-- Name: payments_company_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_company_date_idx ON public.payments USING btree (company_id, payment_date);


--
-- Name: perm_override_changes_company_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX perm_override_changes_company_user_created_idx ON public.permission_override_changes USING btree (company_id, target_user_id, created_at);


--
-- Name: pin_financial_changes_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pin_financial_changes_company_id_idx ON public.pin_financial_changes USING btree (company_id);


--
-- Name: pin_financial_changes_pin_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pin_financial_changes_pin_id_idx ON public.pin_financial_changes USING btree (pin_id);


--
-- Name: report_attestations_primary_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_attestations_primary_version_idx ON public.report_attestations USING btree (inspection_id, blob_version_index) WHERE (supplement_id IS NULL);


--
-- Name: report_attestations_supplement_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_attestations_supplement_version_idx ON public.report_attestations USING btree (inspection_id, supplement_id, blob_version_index) WHERE (supplement_id IS NOT NULL);


--
-- Name: selection_categories_company_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX selection_categories_company_slug_idx ON public.selection_categories USING btree (company_id, slug);


--
-- Name: selection_products_one_base_per_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX selection_products_one_base_per_category_idx ON public.selection_products USING btree (company_id, category_id) WHERE ((is_base = true) AND (is_active = true));


--
-- Name: user_permission_overrides_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_permission_overrides_user_idx ON public.user_permission_overrides USING btree (company_id, user_id);


--
-- Name: user_permission_overrides_user_perm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_permission_overrides_user_perm_idx ON public.user_permission_overrides USING btree (company_id, user_id, permission);


--
-- Name: user_push_tokens_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_push_tokens_company_id_idx ON public.user_push_tokens USING btree (company_id);


--
-- Name: user_push_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_push_tokens_user_id_idx ON public.user_push_tokens USING btree (user_id);


--
-- Name: vendor_expenses_company_pin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_expenses_company_pin_idx ON public.vendor_expenses USING btree (company_id, pin_id);


--
-- Name: agent_prompts agent_prompts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompts
    ADD CONSTRAINT agent_prompts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: agent_prompts agent_prompts_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_prompts
    ADD CONSTRAINT agent_prompts_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ahj_candidate_items ahj_candidate_items_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_candidate_items
    ADD CONSTRAINT ahj_candidate_items_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: ahj_candidate_items ahj_candidate_items_verified_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_candidate_items
    ADD CONSTRAINT ahj_candidate_items_verified_by_users_id_fk FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ahj_candidate_items ahj_candidate_items_wizard_run_id_wizard_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_candidate_items
    ADD CONSTRAINT ahj_candidate_items_wizard_run_id_wizard_runs_id_fk FOREIGN KEY (wizard_run_id) REFERENCES public.wizard_runs(id) ON DELETE CASCADE;


--
-- Name: ahj_packs ahj_packs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_packs
    ADD CONSTRAINT ahj_packs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: ahj_packs ahj_packs_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ahj_packs
    ADD CONSTRAINT ahj_packs_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: attestations attestations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestations
    ADD CONSTRAINT attestations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: attestations attestations_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestations
    ADD CONSTRAINT attestations_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: attestations attestations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attestations
    ADD CONSTRAINT attestations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: boilerplate_sections boilerplate_sections_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boilerplate_sections
    ADD CONSTRAINT boilerplate_sections_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: boilerplate_sections boilerplate_sections_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boilerplate_sections
    ADD CONSTRAINT boilerplate_sections_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bug_reports bug_reports_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: bug_reports bug_reports_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: canvassing_sessions canvassing_sessions_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvassing_sessions
    ADD CONSTRAINT canvassing_sessions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: canvassing_sessions canvassing_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvassing_sessions
    ADD CONSTRAINT canvassing_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: change_order_line_items change_order_line_items_change_order_id_change_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_change_order_id_change_orders_id_fk FOREIGN KEY (change_order_id) REFERENCES public.change_orders(id) ON DELETE CASCADE;


--
-- Name: change_order_line_items change_order_line_items_change_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_change_order_id_fkey FOREIGN KEY (change_order_id) REFERENCES public.change_orders(id) ON DELETE CASCADE;


--
-- Name: change_order_line_items change_order_line_items_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: change_order_line_items change_order_line_items_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: change_order_line_items change_order_line_items_price_book_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_price_book_item_id_fkey FOREIGN KEY (price_book_item_id) REFERENCES public.price_book_items(id);


--
-- Name: change_order_line_items change_order_line_items_price_book_item_id_price_book_items_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_order_line_items
    ADD CONSTRAINT change_order_line_items_price_book_item_id_price_book_items_id_ FOREIGN KEY (price_book_item_id) REFERENCES public.price_book_items(id);


--
-- Name: change_orders change_orders_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: change_orders change_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: change_orders change_orders_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: change_orders change_orders_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: change_orders change_orders_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: change_orders change_orders_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: change_orders change_orders_voided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_voided_by_user_id_fkey FOREIGN KEY (voided_by_user_id) REFERENCES public.users(id);


--
-- Name: change_orders change_orders_voided_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_orders
    ADD CONSTRAINT change_orders_voided_by_user_id_users_id_fk FOREIGN KEY (voided_by_user_id) REFERENCES public.users(id);


--
-- Name: claim_events claim_events_actor_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_events
    ADD CONSTRAINT claim_events_actor_id_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: claim_events claim_events_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_events
    ADD CONSTRAINT claim_events_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_events claim_events_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_events
    ADD CONSTRAINT claim_events_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: claim_sections claim_sections_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_sections claim_sections_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: claim_sections claim_sections_locked_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_locked_by_users_id_fk FOREIGN KEY (locked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: claim_sections claim_sections_supplement_id_claim_supplements_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_supplement_id_claim_supplements_id_fk FOREIGN KEY (supplement_id) REFERENCES public.claim_supplements(id) ON DELETE CASCADE;


--
-- Name: claim_sections claim_sections_supplement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_sections
    ADD CONSTRAINT claim_sections_supplement_id_fkey FOREIGN KEY (supplement_id) REFERENCES public.claim_supplements(id) ON DELETE CASCADE;


--
-- Name: claim_status_history claim_status_history_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: claim_status_history claim_status_history_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: claim_status_history claim_status_history_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_status_history claim_status_history_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_status_history claim_status_history_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: claim_status_history claim_status_history_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_status_history
    ADD CONSTRAINT claim_status_history_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: claim_supplements claim_supplements_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_supplements claim_supplements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: claim_supplements claim_supplements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: claim_supplements claim_supplements_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: claim_supplements claim_supplements_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: claim_supplements claim_supplements_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_supplements
    ADD CONSTRAINT claim_supplements_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: code_sources code_sources_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_sources
    ADD CONSTRAINT code_sources_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: code_sources code_sources_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_sources
    ADD CONSTRAINT code_sources_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: company_crm_config company_crm_config_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_crm_config
    ADD CONSTRAINT company_crm_config_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_jurisdiction_packs company_jurisdiction_packs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_jurisdiction_packs
    ADD CONSTRAINT company_jurisdiction_packs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: company_templates company_templates_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_templates company_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_templates company_templates_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: company_templates company_templates_uploaded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: comparison_set_captions comparison_set_captions_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: comparison_set_captions comparison_set_captions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: comparison_set_captions comparison_set_captions_comparison_pair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_comparison_pair_id_fkey FOREIGN KEY (comparison_pair_id) REFERENCES public.inspection_comparison_pairs(id) ON DELETE CASCADE;


--
-- Name: comparison_set_captions comparison_set_captions_comparison_pair_id_inspection_compariso; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_comparison_pair_id_inspection_compariso FOREIGN KEY (comparison_pair_id) REFERENCES public.inspection_comparison_pairs(id) ON DELETE CASCADE;


--
-- Name: comparison_set_captions comparison_set_captions_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: comparison_set_captions comparison_set_captions_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: comparison_set_captions comparison_set_captions_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.users(id);


--
-- Name: comparison_set_captions comparison_set_captions_locked_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparison_set_captions
    ADD CONSTRAINT comparison_set_captions_locked_by_users_id_fk FOREIGN KEY (locked_by) REFERENCES public.users(id);


--
-- Name: completion_certificates completion_certificates_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: completion_certificates completion_certificates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: completion_certificates completion_certificates_contract_id_contracts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id);


--
-- Name: completion_certificates completion_certificates_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id);


--
-- Name: completion_certificates completion_certificates_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: completion_certificates completion_certificates_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: completion_certificates completion_certificates_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: completion_certificates completion_certificates_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: completion_certificates completion_certificates_signed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_signed_by_user_id_fkey FOREIGN KEY (signed_by_user_id) REFERENCES public.users(id);


--
-- Name: completion_certificates completion_certificates_signed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completion_certificates
    ADD CONSTRAINT completion_certificates_signed_by_user_id_users_id_fk FOREIGN KEY (signed_by_user_id) REFERENCES public.users(id);


--
-- Name: contract_scope_packages contract_scope_packages_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: contract_scope_packages contract_scope_packages_category_id_selection_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_category_id_selection_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: contract_scope_packages contract_scope_packages_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contract_scope_packages contract_scope_packages_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contract_scope_packages contract_scope_packages_contract_id_contracts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id);


--
-- Name: contract_scope_packages contract_scope_packages_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_scope_packages
    ADD CONSTRAINT contract_scope_packages_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_selections contract_selections_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contract_selections contract_selections_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contract_selections contract_selections_contract_id_contracts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id);


--
-- Name: contract_selections contract_selections_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_selections contract_selections_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.selection_options(id);


--
-- Name: contract_selections contract_selections_option_id_selection_options_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_option_id_selection_options_id_fk FOREIGN KEY (option_id) REFERENCES public.selection_options(id);


--
-- Name: contract_selections contract_selections_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.selection_products(id);


--
-- Name: contract_selections contract_selections_product_id_selection_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_product_id_selection_products_id_fk FOREIGN KEY (product_id) REFERENCES public.selection_products(id);


--
-- Name: contract_selections contract_selections_scope_package_id_contract_scope_packages_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_scope_package_id_contract_scope_packages_id FOREIGN KEY (scope_package_id) REFERENCES public.contract_scope_packages(id);


--
-- Name: contract_selections contract_selections_scope_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_scope_package_id_fkey FOREIGN KEY (scope_package_id) REFERENCES public.contract_scope_packages(id);


--
-- Name: contract_selections contract_selections_selected_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_selected_by_user_id_fkey FOREIGN KEY (selected_by_user_id) REFERENCES public.users(id);


--
-- Name: contract_selections contract_selections_selected_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_selections
    ADD CONSTRAINT contract_selections_selected_by_user_id_users_id_fk FOREIGN KEY (selected_by_user_id) REFERENCES public.users(id);


--
-- Name: contracts contracts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contracts contracts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: contracts contracts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: contracts contracts_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: contracts contracts_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id);


--
-- Name: contracts contracts_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.company_templates(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_voided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_voided_by_user_id_fkey FOREIGN KEY (voided_by_user_id) REFERENCES public.users(id);


--
-- Name: contracts contracts_voided_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_voided_by_user_id_users_id_fk FOREIGN KEY (voided_by_user_id) REFERENCES public.users(id);


--
-- Name: corpus_chunks corpus_chunks_code_source_id_code_sources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_chunks
    ADD CONSTRAINT corpus_chunks_code_source_id_code_sources_id_fk FOREIGN KEY (code_source_id) REFERENCES public.code_sources(id) ON DELETE CASCADE;


--
-- Name: corpus_chunks corpus_chunks_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corpus_chunks
    ADD CONSTRAINT corpus_chunks_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: customer_invoices customer_invoices_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: customer_invoices customer_invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: customer_invoices customer_invoices_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: customer_invoices customer_invoices_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: damage_instances damage_instances_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_instances
    ADD CONSTRAINT damage_instances_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: damage_instances damage_instances_elevation_id_inspection_elevations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_instances
    ADD CONSTRAINT damage_instances_elevation_id_inspection_elevations_id_fk FOREIGN KEY (elevation_id) REFERENCES public.inspection_elevations(id) ON DELETE SET NULL;


--
-- Name: damage_instances damage_instances_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_instances
    ADD CONSTRAINT damage_instances_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: damage_instances damage_instances_slope_id_inspection_slopes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_instances
    ADD CONSTRAINT damage_instances_slope_id_inspection_slopes_id_fk FOREIGN KEY (slope_id) REFERENCES public.inspection_slopes(id) ON DELETE SET NULL;


--
-- Name: deactivation_sweep_log deactivation_sweep_log_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deactivation_sweep_log
    ADD CONSTRAINT deactivation_sweep_log_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: deactivation_sweep_log deactivation_sweep_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deactivation_sweep_log
    ADD CONSTRAINT deactivation_sweep_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: deactivation_sweep_log deactivation_sweep_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deactivation_sweep_log
    ADD CONSTRAINT deactivation_sweep_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: deactivation_sweep_log deactivation_sweep_log_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deactivation_sweep_log
    ADD CONSTRAINT deactivation_sweep_log_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: detriment_entries detriment_entries_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detriment_entries
    ADD CONSTRAINT detriment_entries_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: detriment_entries detriment_entries_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detriment_entries
    ADD CONSTRAINT detriment_entries_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: discontinued_products discontinued_products_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discontinued_products
    ADD CONSTRAINT discontinued_products_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: exhibit_captions exhibit_captions_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit_captions
    ADD CONSTRAINT exhibit_captions_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: exhibit_captions exhibit_captions_exhibit_selection_id_inspection_exhibit_select; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit_captions
    ADD CONSTRAINT exhibit_captions_exhibit_selection_id_inspection_exhibit_select FOREIGN KEY (exhibit_selection_id) REFERENCES public.inspection_exhibit_selections(id) ON DELETE CASCADE;


--
-- Name: exhibit_captions exhibit_captions_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit_captions
    ADD CONSTRAINT exhibit_captions_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: exhibit_captions exhibit_captions_locked_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibit_captions
    ADD CONSTRAINT exhibit_captions_locked_by_users_id_fk FOREIGN KEY (locked_by) REFERENCES public.users(id);


--
-- Name: inspection_addenda inspection_addenda_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_addenda
    ADD CONSTRAINT inspection_addenda_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_addenda inspection_addenda_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_addenda
    ADD CONSTRAINT inspection_addenda_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_addenda inspection_addenda_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_addenda
    ADD CONSTRAINT inspection_addenda_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_after_photo_id_inspection_photos_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_after_photo_id_inspection_photos_id FOREIGN KEY (after_photo_id) REFERENCES public.inspection_photos(id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_before_photo_id_inspection_photos_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_before_photo_id_inspection_photos_i FOREIGN KEY (before_photo_id) REFERENCES public.inspection_photos(id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_confirmed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_confirmed_by_users_id_fk FOREIGN KEY (confirmed_by) REFERENCES public.users(id);


--
-- Name: inspection_comparison_pairs inspection_comparison_pairs_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_comparison_pairs
    ADD CONSTRAINT inspection_comparison_pairs_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_components inspection_components_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_components
    ADD CONSTRAINT inspection_components_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_components inspection_components_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_components
    ADD CONSTRAINT inspection_components_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_components inspection_components_slope_id_inspection_slopes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_components
    ADD CONSTRAINT inspection_components_slope_id_inspection_slopes_id_fk FOREIGN KEY (slope_id) REFERENCES public.inspection_slopes(id) ON DELETE SET NULL;


--
-- Name: inspection_elevations inspection_elevations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_elevations
    ADD CONSTRAINT inspection_elevations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_elevations inspection_elevations_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_elevations
    ADD CONSTRAINT inspection_elevations_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_exhibit_selections inspection_exhibit_selections_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_exhibit_selections
    ADD CONSTRAINT inspection_exhibit_selections_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_exhibit_selections inspection_exhibit_selections_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_exhibit_selections
    ADD CONSTRAINT inspection_exhibit_selections_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_exhibit_selections inspection_exhibit_selections_photo_id_inspection_photos_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_exhibit_selections
    ADD CONSTRAINT inspection_exhibit_selections_photo_id_inspection_photos_id_fk FOREIGN KEY (photo_id) REFERENCES public.inspection_photos(id) ON DELETE CASCADE;


--
-- Name: inspection_interior_observations inspection_interior_observations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_interior_observations
    ADD CONSTRAINT inspection_interior_observations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_interior_observations inspection_interior_observations_inspection_id_inspections_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_interior_observations
    ADD CONSTRAINT inspection_interior_observations_inspection_id_inspections_id_f FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_penetrations inspection_penetrations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_penetrations
    ADD CONSTRAINT inspection_penetrations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_penetrations inspection_penetrations_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_penetrations
    ADD CONSTRAINT inspection_penetrations_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_penetrations inspection_penetrations_slope_id_inspection_slopes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_penetrations
    ADD CONSTRAINT inspection_penetrations_slope_id_inspection_slopes_id_fk FOREIGN KEY (slope_id) REFERENCES public.inspection_slopes(id) ON DELETE SET NULL;


--
-- Name: inspection_photos inspection_photos_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_photos
    ADD CONSTRAINT inspection_photos_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_photos inspection_photos_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_photos
    ADD CONSTRAINT inspection_photos_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_products inspection_products_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_products
    ADD CONSTRAINT inspection_products_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_products inspection_products_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_products
    ADD CONSTRAINT inspection_products_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_products inspection_products_slope_id_inspection_slopes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_products
    ADD CONSTRAINT inspection_products_slope_id_inspection_slopes_id_fk FOREIGN KEY (slope_id) REFERENCES public.inspection_slopes(id) ON DELETE SET NULL;


--
-- Name: inspection_siding_facets inspection_siding_facets_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_siding_facets
    ADD CONSTRAINT inspection_siding_facets_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_siding_facets inspection_siding_facets_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_siding_facets
    ADD CONSTRAINT inspection_siding_facets_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_slopes inspection_slopes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_slopes
    ADD CONSTRAINT inspection_slopes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspection_slopes inspection_slopes_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_slopes
    ADD CONSTRAINT inspection_slopes_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: inspections inspections_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: inspections inspections_inspector_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_inspector_user_id_users_id_fk FOREIGN KEY (inspector_user_id) REFERENCES public.users(id);


--
-- Name: inspections inspections_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE SET NULL;


--
-- Name: lead_files lead_files_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_files
    ADD CONSTRAINT lead_files_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: lead_files lead_files_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_files
    ADD CONSTRAINT lead_files_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: lead_files lead_files_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_files
    ADD CONSTRAINT lead_files_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: measurements measurements_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: measurements measurements_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.measurements
    ADD CONSTRAINT measurements_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: notification_preferences notification_preferences_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notification_preferences notification_preferences_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: object_ownership object_ownership_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_ownership
    ADD CONSTRAINT object_ownership_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: object_ownership object_ownership_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_ownership
    ADD CONSTRAINT object_ownership_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: payments payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: payments payments_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: payments payments_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: payments payments_customer_invoice_id_customer_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_customer_invoice_id_customer_invoices_id_fk FOREIGN KEY (customer_invoice_id) REFERENCES public.customer_invoices(id) ON DELETE SET NULL;


--
-- Name: payments payments_customer_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_customer_invoice_id_fkey FOREIGN KEY (customer_invoice_id) REFERENCES public.customer_invoices(id) ON DELETE SET NULL;


--
-- Name: payments payments_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: payments payments_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: permission_override_changes permission_override_changes_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: permission_override_changes permission_override_changes_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: permission_override_changes permission_override_changes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: permission_override_changes permission_override_changes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: permission_override_changes permission_override_changes_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permission_override_changes permission_override_changes_target_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_override_changes
    ADD CONSTRAINT permission_override_changes_target_user_id_users_id_fk FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pin_financial_changes pin_financial_changes_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: pin_financial_changes pin_financial_changes_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id);


--
-- Name: pin_financial_changes pin_financial_changes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: pin_financial_changes pin_financial_changes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: pin_financial_changes pin_financial_changes_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id);


--
-- Name: pin_financial_changes pin_financial_changes_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pin_financial_changes
    ADD CONSTRAINT pin_financial_changes_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id);


--
-- Name: pins pins_appointment_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_appointment_assigned_to_fkey FOREIGN KEY (appointment_assigned_to) REFERENCES public.users(id);


--
-- Name: pins pins_appointment_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_appointment_assigned_to_users_id_fk FOREIGN KEY (appointment_assigned_to) REFERENCES public.users(id);


--
-- Name: pins pins_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: pins pins_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pins
    ADD CONSTRAINT pins_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: price_book_items price_book_items_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_items
    ADD CONSTRAINT price_book_items_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: price_book_package_items price_book_package_items_item_id_price_book_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_package_items
    ADD CONSTRAINT price_book_package_items_item_id_price_book_items_id_fk FOREIGN KEY (item_id) REFERENCES public.price_book_items(id) ON DELETE CASCADE;


--
-- Name: price_book_package_items price_book_package_items_package_id_price_book_packages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_package_items
    ADD CONSTRAINT price_book_package_items_package_id_price_book_packages_id_fk FOREIGN KEY (package_id) REFERENCES public.price_book_packages(id) ON DELETE CASCADE;


--
-- Name: price_book_packages price_book_packages_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_packages
    ADD CONSTRAINT price_book_packages_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: report_attestations report_attestations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: report_attestations report_attestations_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: report_attestations report_attestations_preparer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_preparer_id_users_id_fk FOREIGN KEY (preparer_id) REFERENCES public.users(id);


--
-- Name: report_attestations report_attestations_supplement_id_claim_supplements_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_supplement_id_claim_supplements_id_fk FOREIGN KEY (supplement_id) REFERENCES public.claim_supplements(id) ON DELETE CASCADE;


--
-- Name: report_attestations report_attestations_supplement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_attestations
    ADD CONSTRAINT report_attestations_supplement_id_fkey FOREIGN KEY (supplement_id) REFERENCES public.claim_supplements(id) ON DELETE CASCADE;


--
-- Name: roof_facets roof_facets_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roof_facets
    ADD CONSTRAINT roof_facets_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: selection_brands selection_brands_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_brands
    ADD CONSTRAINT selection_brands_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: selection_brands selection_brands_category_id_selection_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_brands
    ADD CONSTRAINT selection_brands_category_id_selection_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: selection_brands selection_brands_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_brands
    ADD CONSTRAINT selection_brands_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_brands selection_brands_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_brands
    ADD CONSTRAINT selection_brands_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_categories selection_categories_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_categories
    ADD CONSTRAINT selection_categories_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_categories selection_categories_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_categories
    ADD CONSTRAINT selection_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_options selection_options_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_options
    ADD CONSTRAINT selection_options_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.selection_brands(id);


--
-- Name: selection_options selection_options_brand_id_selection_brands_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_options
    ADD CONSTRAINT selection_options_brand_id_selection_brands_id_fk FOREIGN KEY (brand_id) REFERENCES public.selection_brands(id);


--
-- Name: selection_options selection_options_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_options
    ADD CONSTRAINT selection_options_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_options selection_options_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_options
    ADD CONSTRAINT selection_options_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_product_options selection_product_options_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_product_options selection_product_options_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_product_options selection_product_options_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.selection_options(id);


--
-- Name: selection_product_options selection_product_options_option_id_selection_options_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_option_id_selection_options_id_fk FOREIGN KEY (option_id) REFERENCES public.selection_options(id);


--
-- Name: selection_product_options selection_product_options_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.selection_products(id);


--
-- Name: selection_product_options selection_product_options_product_id_selection_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_product_options
    ADD CONSTRAINT selection_product_options_product_id_selection_products_id_fk FOREIGN KEY (product_id) REFERENCES public.selection_products(id);


--
-- Name: selection_products selection_products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.selection_brands(id);


--
-- Name: selection_products selection_products_brand_id_selection_brands_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_brand_id_selection_brands_id_fk FOREIGN KEY (brand_id) REFERENCES public.selection_brands(id);


--
-- Name: selection_products selection_products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: selection_products selection_products_category_id_selection_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_category_id_selection_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.selection_categories(id);


--
-- Name: selection_products selection_products_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: selection_products selection_products_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selection_products
    ADD CONSTRAINT selection_products_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: signed_agreements signed_agreements_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signed_agreements
    ADD CONSTRAINT signed_agreements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: signed_agreements signed_agreements_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signed_agreements
    ADD CONSTRAINT signed_agreements_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE RESTRICT;


--
-- Name: signed_agreements signed_agreements_voided_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signed_agreements
    ADD CONSTRAINT signed_agreements_voided_by_user_id_users_id_fk FOREIGN KEY (voided_by_user_id) REFERENCES public.users(id);


--
-- Name: stage_transitions stage_transitions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transitions
    ADD CONSTRAINT stage_transitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: stage_transitions stage_transitions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_transitions
    ADD CONSTRAINT stage_transitions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: standards_entries standards_entries_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standards_entries
    ADD CONSTRAINT standards_entries_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: standards_entries standards_entries_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.standards_entries
    ADD CONSTRAINT standards_entries_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: test_square_hits test_square_hits_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_square_hits
    ADD CONSTRAINT test_square_hits_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: test_square_hits test_square_hits_test_square_id_test_squares_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_square_hits
    ADD CONSTRAINT test_square_hits_test_square_id_test_squares_id_fk FOREIGN KEY (test_square_id) REFERENCES public.test_squares(id) ON DELETE CASCADE;


--
-- Name: test_squares test_squares_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_squares
    ADD CONSTRAINT test_squares_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: test_squares test_squares_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_squares
    ADD CONSTRAINT test_squares_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: test_squares test_squares_slope_id_inspection_slopes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_squares
    ADD CONSTRAINT test_squares_slope_id_inspection_slopes_id_fk FOREIGN KEY (slope_id) REFERENCES public.inspection_slopes(id) ON DELETE SET NULL;


--
-- Name: user_locations user_locations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: user_locations user_locations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_permission_overrides user_permission_overrides_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: user_permission_overrides user_permission_overrides_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: user_permission_overrides user_permission_overrides_granted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id);


--
-- Name: user_permission_overrides user_permission_overrides_granted_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_granted_by_user_id_users_id_fk FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id);


--
-- Name: user_permission_overrides user_permission_overrides_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_permission_overrides user_permission_overrides_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permission_overrides
    ADD CONSTRAINT user_permission_overrides_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_manager_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_manager_user_id_fkey FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_manager_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_manager_user_id_users_id_fk FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: vendor_expenses vendor_expenses_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_expenses
    ADD CONSTRAINT vendor_expenses_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: vendor_expenses vendor_expenses_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_expenses
    ADD CONSTRAINT vendor_expenses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: vendor_expenses vendor_expenses_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_expenses
    ADD CONSTRAINT vendor_expenses_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: vendor_expenses vendor_expenses_pin_id_pins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_expenses
    ADD CONSTRAINT vendor_expenses_pin_id_pins_id_fk FOREIGN KEY (pin_id) REFERENCES public.pins(id) ON DELETE CASCADE;


--
-- Name: wizard_runs wizard_runs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wizard_runs
    ADD CONSTRAINT wizard_runs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: wizard_runs wizard_runs_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wizard_runs
    ADD CONSTRAINT wizard_runs_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 4rGiR8xhZ9lobjXz52oUw6lqeO80csxTxlCB4UHsOmlaL7ZNR0yEfKK6N8uRK3g

