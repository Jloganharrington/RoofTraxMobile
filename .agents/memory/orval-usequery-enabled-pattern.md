---
name: Orval useQuery enabled pattern
description: TanStack Query v5 UseQueryOptions requires queryKey; passing only { enabled } causes TS error in orval-generated hooks.
---

## Rule

When disabling an orval-generated hook conditionally, always include `queryKey` in the `query` override:

```ts
// CORRECT
const { data } = useGetPinProfitability(pinId, {
  query: { queryKey: getGetPinProfitabilityQueryKey(pinId), enabled: isManager },
});

// WRONG — TS2741: Property 'queryKey' is missing
const { data } = useGetPinProfitability(pinId, { query: { enabled: isManager } });
```

The pattern generalises: for any generated hook `useGetXxx(id, options)`, use the companion `getGetXxxQueryKey(id)` to supply the required `queryKey`.

**Why:** TanStack Query v5 changed `UseQueryOptions` so that `queryKey` is a required field (unlike v4 where hooks inferred it). Orval v8 generates `options.query` typed as `UseQueryOptions<...>`, so TypeScript enforces `queryKey`. At runtime the hook falls back to `getGetXxxQueryKey` if `queryKey` is undefined, but the TypeScript compile fails without it.

**How to apply:** Any time you add `{ query: { enabled: ... } }` to an orval hook call, also add `queryKey: getGet<Name>QueryKey(<args>)`. Both helpers are already exported from `lib/api-client-react/src/generated/api.ts`.
