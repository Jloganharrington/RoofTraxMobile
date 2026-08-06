-- Migration 024 — Customer Invoices
--
-- Creates customer_invoices table and wires up the FK from payments.customer_invoice_id.
-- Sequential invoice numbers are generated server-side using advisory locks;
-- the UNIQUE(company_id, invoice_number) index is the hard backstop.
--
-- Idempotent: all DDL guarded with IF NOT EXISTS / DO $$ blocks.

CREATE TABLE IF NOT EXISTS customer_invoices (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       varchar NOT NULL REFERENCES companies(id),
  pin_id           varchar NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  invoice_number   varchar NOT NULL,
  customer_name    varchar NOT NULL,
  customer_address text    NOT NULL,
  invoice_type     varchar NOT NULL,
  amount_cents     integer NOT NULL,
  status           varchar NOT NULL DEFAULT 'open',  -- open|sent|paid|void
  notes            text,
  pdf_url          text,
  sent_date        timestamptz,
  paid_date        timestamptz,
  payment_method   varchar,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_invoices_company_number_unique
    UNIQUE (company_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS customer_invoices_company_pin_idx
  ON customer_invoices (company_id, pin_id);

-- Add the FK from payments.customer_invoice_id → customer_invoices.id.
-- ON DELETE SET NULL: deleting an invoice must not delete the payment
-- (real money received stays in the ledger).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_customer_invoice_id_fkey'
      AND table_name      = 'payments'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_customer_invoice_id_fkey
      FOREIGN KEY (customer_invoice_id)
      REFERENCES customer_invoices(id)
      ON DELETE SET NULL;
  END IF;
END $$;
