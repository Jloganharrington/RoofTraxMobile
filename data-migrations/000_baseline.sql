-- 000_baseline.sql
-- Generated: 2026-08-11T21:43:40Z
-- Source: drizzle-kit generate --name baseline against live schema
-- This file captures the full database DDL as of the permission-system close-out.
-- Use this file to bootstrap a fresh database instead of running drizzle-kit push
-- (which requires an interactive TTY for conflict resolution).
-- After applying this file, run any data-migrations/*.sql that your environment
-- requires (see README.md).
--
-- Verification: provisioning an empty database from this file and diffing
-- its pg_dump against the live database produced zero differences.
--
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"founder_user_id" varchar,
	"beta_bug_reporting" boolean DEFAULT true NOT NULL,
	"logo_url" varchar,
	"ai_settings" jsonb DEFAULT 'null'::jsonb,
	"contractor_legal_name" varchar,
	"contractor_address" varchar,
	"fipsa_fee_cents" integer,
	"report_branding" jsonb DEFAULT 'null'::jsonb,
	"lead_sources" jsonb DEFAULT 'null'::jsonb,
	"contractor_licenses" jsonb DEFAULT 'null'::jsonb,
	"qualifications_text" varchar,
	"pricing_basis_statement" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_jurisdiction_packs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"jurisdiction" varchar(120) NOT NULL,
	"state" varchar(2) NOT NULL,
	"opening_statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uppa_law" varchar,
	"uppa_statement" varchar,
	"general_code_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"roofing_code_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"siding_code_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"company_id" varchar NOT NULL,
	"deactivated_at" timestamp with time zone,
	"pii_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"route" varchar NOT NULL,
	"route_params" jsonb,
	"severity" varchar NOT NULL,
	"description" text NOT NULL,
	"context" jsonb NOT NULL,
	"screenshot_url" text,
	"app_version" varchar,
	"platform" varchar,
	"os_version" varchar,
	"status" varchar DEFAULT 'new' NOT NULL,
	"internal_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_order_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"change_order_id" varchar NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 4) DEFAULT '1' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"price_book_item_id" varchar,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"required_to_complete_scope" boolean DEFAULT false NOT NULL,
	"document_object_path" text,
	"document_sha256" text,
	"homeowner_signature_path" text,
	"homeowner_signed_at" timestamp with time zone,
	"rep_signature_path" text,
	"rep_signed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" varchar,
	"void_reason" text,
	"emailed_at" timestamp with time zone,
	"carrier_reimbursable" boolean DEFAULT false NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_status_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"from_status" varchar,
	"to_status" varchar,
	"changed_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"object_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"use_case" text NOT NULL,
	"original_filename" text NOT NULL,
	"uploaded_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion_certificates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"contract_id" varchar,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"document_object_path" text,
	"document_sha256" text,
	"signed_by_user_id" varchar,
	"signed_at" timestamp with time zone,
	"signer_title" text,
	"line_items" jsonb,
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_scope_packages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contract_id" varchar NOT NULL,
	"category_id" varchar NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" varchar NOT NULL,
	"covered_amount_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_selections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contract_id" varchar NOT NULL,
	"scope_package_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"option_id" varchar,
	"product_name" varchar NOT NULL,
	"brand_name" varchar NOT NULL,
	"option_name" varchar,
	"unit_delta_cents" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"extended_delta_cents" integer NOT NULL,
	"selected_by" varchar NOT NULL,
	"selected_by_user_id" varchar,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"access_code" varchar NOT NULL,
	"access_code_expires_at" timestamp with time zone,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"covered_scope_cents" integer DEFAULT 0 NOT NULL,
	"betterments_cents" integer DEFAULT 0 NOT NULL,
	"deductible_cents" integer DEFAULT 0 NOT NULL,
	"total_contract_cents" integer DEFAULT 0 NOT NULL,
	"scope_summary" text,
	"scope_source" varchar,
	"template_id" varchar,
	"document_object_path" text,
	"document_sha256" text,
	"customer_signature_path" text,
	"customer_signed_at" timestamp with time zone,
	"customer_print_name" varchar,
	"rep_signature_path" text,
	"rep_signed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" varchar,
	"void_reason" text,
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"invoice_number" varchar NOT NULL,
	"customer_name" varchar NOT NULL,
	"customer_address" text NOT NULL,
	"invoice_type" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"notes" text,
	"pdf_url" text,
	"sent_date" timestamp with time zone,
	"paid_date" timestamp with time zone,
	"payment_method" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deactivation_sweep_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"deactivated_at" timestamp with time zone NOT NULL,
	"days_since" integer NOT NULL,
	"action_taken" varchar NOT NULL,
	"blocked_reason" text,
	"detail" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discontinued_products" (
	"id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"photo_path" text,
	"width_inches" double precision,
	"exposure_inches" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_files" (
	"id" varchar PRIMARY KEY NOT NULL,
	"lead_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"object_path" text NOT NULL,
	"file_name" text NOT NULL,
	"original_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar NOT NULL,
	"category" varchar DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"notification_type" varchar NOT NULL,
	"email_enabled" boolean NOT NULL,
	"push_enabled" boolean NOT NULL,
	"frequency" varchar DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_ownership" (
	"object_path" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" varchar,
	"payment_date" timestamp with time zone NOT NULL,
	"notes" text,
	"customer_invoice_id" varchar,
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pin_financial_changes" (
	"id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by_user_id" varchar NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"address" text,
	"workflow" varchar NOT NULL,
	"damage_type" varchar,
	"photo_url" text,
	"door_knock_result" varchar,
	"retail_data" jsonb,
	"contact_outcome" varchar,
	"customer_name" text,
	"customer_phone" text,
	"status" varchar DEFAULT 'active' NOT NULL,
	"owner_first_name" text,
	"owner_last_name" text,
	"owner_email" text,
	"owner2_first_name" text,
	"owner2_last_name" text,
	"notes" text,
	"pipeline_stage" varchar,
	"profile_status" varchar,
	"status_notes" text,
	"status_last_updated" timestamp with time zone,
	"insurance_carrier" varchar,
	"policy_number" varchar,
	"claim_number" varchar,
	"date_of_loss" timestamp with time zone,
	"inspection_date" timestamp with time zone,
	"adjuster_name" varchar,
	"adjuster_phone" varchar,
	"adjuster_email" varchar,
	"adjuster_meeting_date" timestamp with time zone,
	"contract_amount" varchar,
	"deposit_amount" varchar,
	"deposit_date" timestamp with time zone,
	"deposit_payment_method" varchar,
	"deductible_amount" varchar,
	"rcv_amount" varchar,
	"acv_amount" varchar,
	"supplement_amount" varchar,
	"final_payment_amount" varchar,
	"contract_scope" text,
	"square_footage" varchar,
	"roof_pitch" varchar,
	"measurement_vendor" varchar,
	"measurement_report_url" text,
	"material_brand" varchar,
	"material_color" varchar,
	"material_style" varchar,
	"non_owner_occupied" boolean DEFAULT false,
	"mailing_address" text,
	"mailing_city" varchar,
	"mailing_state" varchar,
	"mailing_zip" varchar,
	"mailer_sent_date" timestamp with time zone,
	"claim_filed_date" timestamp with time zone,
	"policy_holder" varchar,
	"coverage_type" varchar,
	"approved_rcv_amount" varchar,
	"approved_acv_amount" varchar,
	"depreciation_amount" varchar,
	"inspection_notes" text,
	"stage_entered_at" timestamp with time zone,
	"loop_next_action_at" timestamp with time zone,
	"loss_reason" varchar,
	"source_pipeline" varchar,
	"external_lead_source" varchar,
	"project_manager_name" varchar,
	"is_demo" boolean DEFAULT false NOT NULL,
	"needs_stage_review" boolean DEFAULT false NOT NULL,
	"lead_acquisition_cost_cents" integer,
	"referral_fee_cents" integer,
	"sales_commission_cents" integer,
	"sales_commission_paid_date" timestamp with time zone,
	"pm_commission_cents" integer,
	"pm_commission_paid_date" timestamp with time zone,
	"canvassing_commission_cents" integer,
	"canvassing_commission_paid_date" timestamp with time zone,
	"referral_fee_paid_date" timestamp with time zone,
	"lead_acquisition_paid_date" timestamp with time zone,
	"claim_status" varchar,
	"adjuster_last_contact" timestamp with time zone,
	"betterments_amount_cents" integer,
	"supplement_notes" text,
	"appointment_at" timestamp with time zone,
	"appointment_assigned_to" varchar,
	"appointment_status" varchar,
	"approved_estimate_object_path" text,
	"approved_estimate_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_book_items" (
	"id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"unit" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_book_package_items" (
	"package_id" varchar NOT NULL,
	"item_id" varchar NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_book_package_items_package_id_item_id_pk" PRIMARY KEY("package_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "price_book_packages" (
	"id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"inspection_condition" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_brands" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"category_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"logo_path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_options" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"name" varchar(120) NOT NULL,
	"option_group" varchar(80),
	"swatch_hex" varchar(7),
	"swatch_image_path" text,
	"hoa_compliant" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_product_options" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"product_id" varchar NOT NULL,
	"option_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selection_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"category_id" varchar NOT NULL,
	"brand_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"specs" jsonb,
	"is_base" boolean DEFAULT false NOT NULL,
	"price_delta_cents" integer DEFAULT 0 NOT NULL,
	"unit" varchar(60) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_transitions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"from_stage" varchar,
	"to_stage" varchar NOT NULL,
	"trigger" varchar NOT NULL,
	"task_payload" jsonb,
	"user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"company_id" varchar NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"role" varchar DEFAULT 'field_rep' NOT NULL,
	"workflow_assignment" varchar DEFAULT 'insurance_retail' NOT NULL,
	"department" varchar DEFAULT 'canvasser' NOT NULL,
	"signature_url" text,
	"signature_sha256" text,
	"signature_signed_at" timestamp with time zone,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean,
	"smtp_username" text,
	"smtp_password_enc" text,
	"smtp_from_email" text,
	"certifications" jsonb,
	"years_experience" integer,
	"phone" text,
	"title" text,
	"theme" varchar DEFAULT 'dark' NOT NULL,
	"dashboard_layout" jsonb DEFAULT 'null'::jsonb,
	"manager_user_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_push_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"expo_push_token" varchar NOT NULL,
	"device_label" varchar,
	"platform" varchar,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_expenses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar NOT NULL,
	"vendor_name" varchar NOT NULL,
	"invoice_number" varchar,
	"invoice_date" timestamp with time zone,
	"amount_cents" integer NOT NULL,
	"category" varchar NOT NULL,
	"description" text,
	"document_url" text,
	"is_paid" boolean DEFAULT false NOT NULL,
	"paid_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_prompts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"agent_key" varchar NOT NULL,
	"system_prompt" text NOT NULL,
	"updated_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ahj_packs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pack_type" varchar NOT NULL,
	"jurisdiction" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "attestations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"stage" varchar,
	"attestation_type" varchar,
	"details" jsonb,
	"signature_data" text,
	"attested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boilerplate_sections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"section_key" varchar NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"event_type" varchar NOT NULL,
	"payload" jsonb,
	"actor_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_sections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"supplement_id" varchar,
	"section_type" varchar NOT NULL,
	"state" varchar DEFAULT 'not_started' NOT NULL,
	"content_html" text,
	"lint_status" varchar,
	"lint_findings" jsonb,
	"gate_flags" jsonb,
	"generated_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" varchar,
	"library_version_snapshot" jsonb,
	"staled_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_supplements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"supplement_number" text NOT NULL,
	"supplement_reason" varchar NOT NULL,
	"compiled_report_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_package_blob_version" text,
	"original_attestation_id" text,
	"legacy_inline_supplement" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "company_crm_config" (
	"company_id" varchar PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"field_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_comparison_pairs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"before_photo_id" varchar NOT NULL,
	"after_photo_id" varchar NOT NULL,
	"pair_type" varchar NOT NULL,
	"confirmed_by" varchar,
	"confirmed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison_set_captions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"comparison_pair_id" varchar NOT NULL,
	"caption_text" text,
	"state" varchar DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "damage_instances" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"slope_id" varchar,
	"elevation_id" varchar,
	"damage_type" text NOT NULL,
	"severity" text,
	"causation_note" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detriment_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"entry_key" varchar NOT NULL,
	"applicability_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statement" text DEFAULT '' NOT NULL,
	"required_support" text,
	"limitation" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "exhibit_captions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"exhibit_selection_id" varchar NOT NULL,
	"badge_label" varchar NOT NULL,
	"caption_text" text,
	"state" varchar DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_exhibit_selections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"photo_id" varchar NOT NULL,
	"exhibit_class" varchar,
	"badge_label" varchar,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_ai_proposed" boolean DEFAULT false NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_addenda" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_components" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"slope_id" varchar,
	"component_type" varchar NOT NULL,
	"status" varchar,
	"layer_count" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_elevations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"direction" varchar NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_interior_observations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"location" text NOT NULL,
	"observation_type" varchar NOT NULL,
	"moisture_reading" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_penetrations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"slope_id" varchar,
	"penetration_type" varchar NOT NULL,
	"flashing_condition" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"stage" varchar,
	"subject_type" varchar NOT NULL,
	"subject_id" varchar,
	"triad_role" varchar,
	"preliminary_role" varchar,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"exif_json" jsonb,
	"overlay_json" jsonb,
	"captured_at_utc" timestamp with time zone,
	"latitude" double precision,
	"longitude" double precision,
	"zone" varchar,
	"siding_role" varchar,
	"siding_component_index" integer,
	"include_in_proof_package" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_products" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"slope_id" varchar,
	"category" text,
	"brand" text,
	"product_line" text,
	"identification_method" varchar NOT NULL,
	"itel_sample_ref" text,
	"unidentifiable_reason" text,
	"notes" text,
	"discontinued" varchar,
	"ordinary_availability" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_siding_facets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"label" text NOT NULL,
	"area_sqft" real,
	"damaged" boolean DEFAULT false NOT NULL,
	"damage_type" varchar,
	"wrb_present" boolean,
	"isolated" boolean,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"pre_existing_conditions" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_slopes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"label" text NOT NULL,
	"pitch_rise" double precision,
	"pitch_run" double precision,
	"material_type" text,
	"area_sqft" double precision,
	"damage_type" varchar,
	"damage_present" boolean DEFAULT false NOT NULL,
	"tie_in_valley" boolean DEFAULT false NOT NULL,
	"tie_in_hip_ridge" boolean DEFAULT false NOT NULL,
	"notes" text,
	"compass_bearing" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"pin_id" varchar,
	"inspector_user_id" varchar NOT NULL,
	"status" varchar DEFAULT 'scheduled' NOT NULL,
	"phase" varchar DEFAULT 'forensic' NOT NULL,
	"damage_type" text,
	"preliminary_completed_at" timestamp with time zone,
	"claim_number" text,
	"policy_number" text,
	"carrier_name" text,
	"insured_name" text,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"notes" text,
	"date_of_loss" text,
	"storm_confirmed_ref" jsonb,
	"arrival_conditions" jsonb,
	"homeowner_facts" jsonb,
	"submission_manifest" jsonb,
	"locked_at" timestamp with time zone,
	"roof_damage_found" boolean DEFAULT false NOT NULL,
	"siding_damage_found" boolean DEFAULT false NOT NULL,
	"siding_wrb_present" boolean,
	"collateral_damage_found" boolean DEFAULT false NOT NULL,
	"interior_damage_found" boolean DEFAULT false NOT NULL,
	"siding_measurement_report_ref" text,
	"measurements_report_url" text,
	"facet_inventory" jsonb,
	"facet_count" integer,
	"facet_inventory_status" text,
	"property_profile" jsonb,
	"repairability_assessment" jsonb,
	"existing_or_unrelated_conditions" jsonb,
	"temporary_repairs" jsonb,
	"property_protection_plan" jsonb,
	"damage_surface_change_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimate" jsonb DEFAULT 'null'::jsonb,
	"ai_summary" jsonb DEFAULT 'null'::jsonb,
	"compiled_report_path" text,
	"compiled_report_ready_at" timestamp with time zone,
	"compiled_report_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report_lint_resolution" jsonb DEFAULT 'null'::jsonb,
	"unlock_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"portal_access_code" text,
	"portal_access_revoked_at" timestamp with time zone,
	"owner_email" text,
	"scheduled_for" timestamp with time zone,
	"rap_gate_reason" varchar,
	"trigger_flags" jsonb,
	"ahj_check" jsonb,
	"exhibit_badge_map" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_portal_access_code_unique" UNIQUE("portal_access_code")
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"subject_type" varchar NOT NULL,
	"subject_id" varchar,
	"measurement_type" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_attestations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"supplement_id" varchar,
	"preparer_id" varchar NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blob_version_index" integer NOT NULL,
	"statement_hash" varchar(64) NOT NULL,
	"statement_text" text NOT NULL,
	"attestation_block_key" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roof_facets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"facet_id" text NOT NULL,
	"area_sq_ft" real NOT NULL,
	"pitch" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_agreements" (
	"id" varchar PRIMARY KEY NOT NULL,
	"inspection_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"signer_name" text NOT NULL,
	"document_version" varchar(20) NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_metadata" jsonb NOT NULL,
	"document_object_path" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" varchar,
	"void_reason" text,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "standards_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"entry_key" varchar NOT NULL,
	"title" text,
	"source_type" varchar,
	"citation_text" text,
	"verification_status" varchar DEFAULT 'verify_before_ship' NOT NULL,
	"verified_at" timestamp with time zone,
	"authority_limit" text,
	"locator_template" text,
	"human_entered_provisions_only" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "test_square_hits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"test_square_id" varchar NOT NULL,
	"hit_type" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_squares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"inspection_id" varchar NOT NULL,
	"slope_id" varchar,
	"label" text NOT NULL,
	"size_sq_ft" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvassing_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ahj_candidate_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"wizard_run_id" varchar NOT NULL,
	"pack_type" varchar NOT NULL,
	"jurisdiction" text NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"candidate_key" text NOT NULL,
	"citation" text,
	"edition" text,
	"provision_summary" text,
	"classification" varchar NOT NULL,
	"factual_trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_connection" text,
	"source_locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"amendment_note" text,
	"confidence" double precision,
	"gaps_context" jsonb,
	"lint_note" text,
	"verified_by" varchar,
	"verified_at" timestamp with time zone,
	"edit_diff" jsonb,
	"rejection_reason" text,
	"category" text NOT NULL,
	"material_applicability" jsonb DEFAULT '["all"]'::jsonb NOT NULL,
	"needs_material_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"jurisdiction" text NOT NULL,
	"title" text NOT NULL,
	"edition" text NOT NULL,
	"effective_date" text,
	"source_url" text,
	"acquisition_basis" varchar NOT NULL,
	"licensing_note" text NOT NULL,
	"stored_corpus" boolean DEFAULT false NOT NULL,
	"accessed_at" timestamp with time zone,
	"created_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_source_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"section_id" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wizard_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"jurisdiction" text NOT NULL,
	"pack_type" varchar NOT NULL,
	"code_source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"category_sweep" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'running' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_override_changes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"target_user_id" varchar NOT NULL,
	"permission" varchar(100) NOT NULL,
	"previous_state" varchar(10),
	"new_state" varchar(10),
	"note" text NOT NULL,
	"actor_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"permission" varchar(100) NOT NULL,
	"granted" boolean NOT NULL,
	"granted_by_user_id" varchar NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_jurisdiction_packs" ADD CONSTRAINT "company_jurisdiction_packs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_price_book_item_id_price_book_items_id_fk" FOREIGN KEY ("price_book_item_id") REFERENCES "public"."price_book_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_scope_packages" ADD CONSTRAINT "contract_scope_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_scope_packages" ADD CONSTRAINT "contract_scope_packages_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_scope_packages" ADD CONSTRAINT "contract_scope_packages_category_id_selection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_scope_package_id_contract_scope_packages_id_fk" FOREIGN KEY ("scope_package_id") REFERENCES "public"."contract_scope_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_product_id_selection_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."selection_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_option_id_selection_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."selection_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_selections" ADD CONSTRAINT "contract_selections_selected_by_user_id_users_id_fk" FOREIGN KEY ("selected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deactivation_sweep_log" ADD CONSTRAINT "deactivation_sweep_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deactivation_sweep_log" ADD CONSTRAINT "deactivation_sweep_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discontinued_products" ADD CONSTRAINT "discontinued_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_files" ADD CONSTRAINT "lead_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_files" ADD CONSTRAINT "lead_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_ownership" ADD CONSTRAINT "object_ownership_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_ownership" ADD CONSTRAINT "object_ownership_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("customer_invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_financial_changes" ADD CONSTRAINT "pin_financial_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_financial_changes" ADD CONSTRAINT "pin_financial_changes_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_financial_changes" ADD CONSTRAINT "pin_financial_changes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_appointment_assigned_to_users_id_fk" FOREIGN KEY ("appointment_assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_package_items" ADD CONSTRAINT "price_book_package_items_package_id_price_book_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."price_book_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_package_items" ADD CONSTRAINT "price_book_package_items_item_id_price_book_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."price_book_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_packages" ADD CONSTRAINT "price_book_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_brands" ADD CONSTRAINT "selection_brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_brands" ADD CONSTRAINT "selection_brands_category_id_selection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_categories" ADD CONSTRAINT "selection_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_options" ADD CONSTRAINT "selection_options_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_options" ADD CONSTRAINT "selection_options_brand_id_selection_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."selection_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_product_options" ADD CONSTRAINT "selection_product_options_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_product_options" ADD CONSTRAINT "selection_product_options_product_id_selection_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."selection_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_product_options" ADD CONSTRAINT "selection_product_options_option_id_selection_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."selection_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_products" ADD CONSTRAINT "selection_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_products" ADD CONSTRAINT "selection_products_category_id_selection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_products" ADD CONSTRAINT "selection_products_brand_id_selection_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."selection_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_push_tokens" ADD CONSTRAINT "user_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_expenses" ADD CONSTRAINT "vendor_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_expenses" ADD CONSTRAINT "vendor_expenses_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompts" ADD CONSTRAINT "agent_prompts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompts" ADD CONSTRAINT "agent_prompts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahj_packs" ADD CONSTRAINT "ahj_packs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahj_packs" ADD CONSTRAINT "ahj_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boilerplate_sections" ADD CONSTRAINT "boilerplate_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boilerplate_sections" ADD CONSTRAINT "boilerplate_sections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD CONSTRAINT "claim_sections_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD CONSTRAINT "claim_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD CONSTRAINT "claim_sections_supplement_id_claim_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."claim_supplements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD CONSTRAINT "claim_sections_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_crm_config" ADD CONSTRAINT "company_crm_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_comparison_pairs" ADD CONSTRAINT "inspection_comparison_pairs_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_comparison_pairs" ADD CONSTRAINT "inspection_comparison_pairs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_comparison_pairs" ADD CONSTRAINT "inspection_comparison_pairs_before_photo_id_inspection_photos_id_fk" FOREIGN KEY ("before_photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_comparison_pairs" ADD CONSTRAINT "inspection_comparison_pairs_after_photo_id_inspection_photos_id_fk" FOREIGN KEY ("after_photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_comparison_pairs" ADD CONSTRAINT "inspection_comparison_pairs_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_comparison_pair_id_inspection_comparison_pairs_id_fk" FOREIGN KEY ("comparison_pair_id") REFERENCES "public"."inspection_comparison_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_instances" ADD CONSTRAINT "damage_instances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_instances" ADD CONSTRAINT "damage_instances_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_instances" ADD CONSTRAINT "damage_instances_slope_id_inspection_slopes_id_fk" FOREIGN KEY ("slope_id") REFERENCES "public"."inspection_slopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_instances" ADD CONSTRAINT "damage_instances_elevation_id_inspection_elevations_id_fk" FOREIGN KEY ("elevation_id") REFERENCES "public"."inspection_elevations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detriment_entries" ADD CONSTRAINT "detriment_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detriment_entries" ADD CONSTRAINT "detriment_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_captions" ADD CONSTRAINT "exhibit_captions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_captions" ADD CONSTRAINT "exhibit_captions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_captions" ADD CONSTRAINT "exhibit_captions_exhibit_selection_id_inspection_exhibit_selections_id_fk" FOREIGN KEY ("exhibit_selection_id") REFERENCES "public"."inspection_exhibit_selections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibit_captions" ADD CONSTRAINT "exhibit_captions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_exhibit_selections" ADD CONSTRAINT "inspection_exhibit_selections_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_exhibit_selections" ADD CONSTRAINT "inspection_exhibit_selections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_exhibit_selections" ADD CONSTRAINT "inspection_exhibit_selections_photo_id_inspection_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_addenda" ADD CONSTRAINT "inspection_addenda_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_addenda" ADD CONSTRAINT "inspection_addenda_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_addenda" ADD CONSTRAINT "inspection_addenda_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_components" ADD CONSTRAINT "inspection_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_components" ADD CONSTRAINT "inspection_components_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_components" ADD CONSTRAINT "inspection_components_slope_id_inspection_slopes_id_fk" FOREIGN KEY ("slope_id") REFERENCES "public"."inspection_slopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_elevations" ADD CONSTRAINT "inspection_elevations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_elevations" ADD CONSTRAINT "inspection_elevations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_interior_observations" ADD CONSTRAINT "inspection_interior_observations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_interior_observations" ADD CONSTRAINT "inspection_interior_observations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_penetrations" ADD CONSTRAINT "inspection_penetrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_penetrations" ADD CONSTRAINT "inspection_penetrations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_penetrations" ADD CONSTRAINT "inspection_penetrations_slope_id_inspection_slopes_id_fk" FOREIGN KEY ("slope_id") REFERENCES "public"."inspection_slopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_products" ADD CONSTRAINT "inspection_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_products" ADD CONSTRAINT "inspection_products_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_products" ADD CONSTRAINT "inspection_products_slope_id_inspection_slopes_id_fk" FOREIGN KEY ("slope_id") REFERENCES "public"."inspection_slopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_siding_facets" ADD CONSTRAINT "inspection_siding_facets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_siding_facets" ADD CONSTRAINT "inspection_siding_facets_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_slopes" ADD CONSTRAINT "inspection_slopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_slopes" ADD CONSTRAINT "inspection_slopes_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_user_id_users_id_fk" FOREIGN KEY ("inspector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD CONSTRAINT "report_attestations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD CONSTRAINT "report_attestations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD CONSTRAINT "report_attestations_supplement_id_claim_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."claim_supplements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD CONSTRAINT "report_attestations_preparer_id_users_id_fk" FOREIGN KEY ("preparer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roof_facets" ADD CONSTRAINT "roof_facets_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_agreements" ADD CONSTRAINT "signed_agreements_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_agreements" ADD CONSTRAINT "signed_agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_agreements" ADD CONSTRAINT "signed_agreements_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standards_entries" ADD CONSTRAINT "standards_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standards_entries" ADD CONSTRAINT "standards_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_square_hits" ADD CONSTRAINT "test_square_hits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_square_hits" ADD CONSTRAINT "test_square_hits_test_square_id_test_squares_id_fk" FOREIGN KEY ("test_square_id") REFERENCES "public"."test_squares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_squares" ADD CONSTRAINT "test_squares_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_squares" ADD CONSTRAINT "test_squares_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_squares" ADD CONSTRAINT "test_squares_slope_id_inspection_slopes_id_fk" FOREIGN KEY ("slope_id") REFERENCES "public"."inspection_slopes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvassing_sessions" ADD CONSTRAINT "canvassing_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvassing_sessions" ADD CONSTRAINT "canvassing_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahj_candidate_items" ADD CONSTRAINT "ahj_candidate_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahj_candidate_items" ADD CONSTRAINT "ahj_candidate_items_wizard_run_id_wizard_runs_id_fk" FOREIGN KEY ("wizard_run_id") REFERENCES "public"."wizard_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ahj_candidate_items" ADD CONSTRAINT "ahj_candidate_items_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sources" ADD CONSTRAINT "code_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_chunks" ADD CONSTRAINT "corpus_chunks_code_source_id_code_sources_id_fk" FOREIGN KEY ("code_source_id") REFERENCES "public"."code_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_chunks" ADD CONSTRAINT "corpus_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_runs" ADD CONSTRAINT "wizard_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wizard_runs" ADD CONSTRAINT "wizard_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_override_changes" ADD CONSTRAINT "permission_override_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_override_changes" ADD CONSTRAINT "permission_override_changes_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_override_changes" ADD CONSTRAINT "permission_override_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_jurisdiction_packs_company_jurisdiction_idx" ON "company_jurisdiction_packs" USING btree ("company_id","jurisdiction");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user_type_uniq" ON "notification_preferences" USING btree ("user_id","notification_type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_push_tokens_token_uq" ON "user_push_tokens" USING btree ("expo_push_token");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_prompts_company_key_uidx" ON "agent_prompts" USING btree ("company_id","agent_key");--> statement-breakpoint
CREATE INDEX "perm_override_changes_company_user_created_idx" ON "permission_override_changes" USING btree ("company_id","target_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_overrides_user_perm_idx" ON "user_permission_overrides" USING btree ("company_id","user_id","permission");--> statement-breakpoint
CREATE INDEX "user_permission_overrides_user_idx" ON "user_permission_overrides" USING btree ("company_id","user_id");