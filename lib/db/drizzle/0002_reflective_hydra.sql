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
	"created_by_user_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
DROP INDEX "report_attestations_inspection_version_idx";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lead_sources" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "external_lead_source" varchar;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "project_manager_name" varchar;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "lead_acquisition_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "referral_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "sales_commission_cents" integer;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "sales_commission_paid_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "pm_commission_cents" integer;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "pm_commission_paid_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "canvassing_commission_cents" integer;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "canvassing_commission_paid_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "referral_fee_paid_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pins" ADD COLUMN "lead_acquisition_paid_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "theme" varchar DEFAULT 'dark' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "dashboard_layout" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD COLUMN "supplement_id" varchar;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD COLUMN "supplement_id" varchar;--> statement-breakpoint
ALTER TABLE "standards_entries" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_order_line_items" ADD CONSTRAINT "change_order_line_items_price_book_item_id_price_book_items_id_fk" FOREIGN KEY ("price_book_item_id") REFERENCES "public"."price_book_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("customer_invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_expenses" ADD CONSTRAINT "vendor_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_expenses" ADD CONSTRAINT "vendor_expenses_pin_id_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supplements" ADD CONSTRAINT "claim_supplements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_comparison_pair_id_inspection_comparison_pairs_id_fk" FOREIGN KEY ("comparison_pair_id") REFERENCES "public"."inspection_comparison_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison_set_captions" ADD CONSTRAINT "comparison_set_captions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_sections" ADD CONSTRAINT "claim_sections_supplement_id_claim_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."claim_supplements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attestations" ADD CONSTRAINT "report_attestations_supplement_id_claim_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."claim_supplements"("id") ON DELETE cascade ON UPDATE no action;