-- Remediation Plan – vocabulary migrations
-- Track B F-7: rename inspection component statuses
-- absent → not_observed, not_determined → undetermined
UPDATE inspection_components
SET status = CASE
  WHEN status = 'absent' THEN 'not_observed'
  WHEN status = 'not_determined' THEN 'undetermined'
  ELSE status
END
WHERE status IN ('absent', 'not_determined');

-- Track C F-9: rename comparison pair types
-- pre_post_loss → recency, directional_comparison → recency
-- condition_differentiation → covered_vs_unrelated
UPDATE inspection_comparison_pairs
SET pair_type = CASE
  WHEN pair_type = 'pre_post_loss' THEN 'recency'
  WHEN pair_type = 'directional_comparison' THEN 'recency'
  WHEN pair_type = 'condition_differentiation' THEN 'covered_vs_unrelated'
  ELSE pair_type
END
WHERE pair_type IN ('pre_post_loss', 'directional_comparison', 'condition_differentiation');

-- Track B F-5: flag IICRC entries that contain human-authored licensed provisions
-- (STD-WTR-01 = IICRC S500 water damage standard; STD-WTR-02 = IICRC S520 mold standard)
UPDATE standards_entries
SET human_entered_provisions_only = true
WHERE entry_key IN ('STD-WTR-01', 'STD-WTR-02');
