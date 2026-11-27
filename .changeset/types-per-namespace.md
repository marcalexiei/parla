---
'@parlajs/compiler': minor
---

feat: each namespace's interface is in its own `types/{namespace}.d.ts`, which `catalog.d.ts` imports and re-exports

A package that publishes its `.d.ts` must ship `types/` beside `catalog.d.ts`.
