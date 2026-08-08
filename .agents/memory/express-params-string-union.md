---
name: Express req.params string | string[] type
description: In this workspace's @types/express-serve-static-core, ParamsDictionary values are typed as string | string[], not string. This breaks Drizzle eq() overloads.
---

## Rule
Always narrow `req.params` values with `as string` before passing to Drizzle `eq()` or any API that expects a plain `string`.

**Bad (causes TS2769 on Drizzle eq overloads):**
```ts
const { categoryId } = req.params;
eq(table.id, categoryId)  // TS error: string | string[] not assignable to string | SQLWrapper
```

**Good:**
```ts
const categoryId = req.params.categoryId as string;
eq(table.id, categoryId)  // ✅
```

## Why
`@types/express-serve-static-core` in this workspace defines `ParamsDictionary` as:
```ts
interface ParamsDictionary {
    [key: string]: string | string[];
    [key: number]: string;
}
```
So any destructuring `const { id } = req.params` produces `string | string[]`.

Drizzle `BinaryOperator` overload 1 expects `right: GetColumnData<TColumn, 'raw'> | SQLWrapper` which resolves to `string | SQLWrapper` for varchar columns — incompatible with `string | string[]`.

## How to apply
Any new route file that uses `req.params.xxx` in a Drizzle `eq()` call needs `as string`. Same applies to `inArray()` and any other Drizzle comparators that take a typed column value. This is NOT needed for `req.query` (already handled with `typeof x === 'string'` guards) or `req.body` (Zod-parsed).
