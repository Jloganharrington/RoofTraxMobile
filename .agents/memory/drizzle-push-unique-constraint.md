---
name: drizzle push blocks on new unique constraints
description: Non-interactive `drizzle-kit push` fails (TTY prompt) when adding a unique constraint to a non-empty table; --force does not bypass that prompt.
---

Adding a unique constraint to an existing non-empty table makes `drizzle-kit push` raise an interactive "truncate?" prompt that no flag suppresses in a non-interactive shell (`--force` still prompts).

**Why:** the prompt is a data-safety suggestion, not a confirm — drizzle has no auto-accept for it.

**How to apply:** apply the DDL directly via SQL (`ALTER TABLE ... ADD COLUMN ...; ADD CONSTRAINT ... UNIQUE`), keeping it identical to the schema file so a later push sees no diff.
