---
name: Tenant preset-role permission policies
description: Precedence and authorization boundaries for company-specific standard role permissions.
---

Company-specific preset-role permission policies are opt-in deviations from the shared `@workspace/authz` registry. They apply only to users in the selected role and company, never across tenants.

**Why:** The shared registry defines secure product-wide defaults, while individual companies need controlled adjustments to their own preset roles without mutating another tenant's policy.

**How to apply:** Resolve authorization in this order: explicit per-user override, company role policy, then shared registry default. Treat role policies as company-wide security settings: only a super admin may change them, require an audit reason for every set or reset, and preserve the registry as the fallback when a policy is cleared.