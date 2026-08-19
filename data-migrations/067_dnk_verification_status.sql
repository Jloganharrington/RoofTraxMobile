-- Retail Do Not Knock pins are reviewed by an insurance canvasser before
-- being finalized as no visible damage or mailer campaign.
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS dnk_verification_status varchar(32);

ALTER TABLE pins
  DROP CONSTRAINT IF EXISTS pins_dnk_verification_status_check;

ALTER TABLE pins
  ADD CONSTRAINT pins_dnk_verification_status_check
  CHECK (
    dnk_verification_status IS NULL
    OR dnk_verification_status IN (
      'pending',
      'no_visible_damage',
      'mailer_campaign'
    )
  );