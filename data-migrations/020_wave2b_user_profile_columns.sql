-- 020: Wave-2B personal profile columns on user_profiles
-- phone:            per-user contact number, editable via PATCH /profile/me
-- theme:            ui preference; defaults 'dark' so existing users see no change
-- dashboard_layout: widget visibility + order, managed via PATCH/DELETE /dashboard/layout
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'dark'
    CONSTRAINT user_profiles_theme_check CHECK (theme IN ('light', 'dark', 'system')),
  ADD COLUMN IF NOT EXISTS dashboard_layout JSONB;
