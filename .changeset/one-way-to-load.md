---
'@parlajs/core': minor
'@parlajs/react': minor
---

feat!: one way to load: `parla.load(['ns'])` and `useParla(['ns'])` return `t` keyed by namespace

Replace `useT('ns')` with `const { t } = useParla(['ns'])` and `t.key()` with `t.ns.key()`; `getT`, `preload` and `getSnapshot` are gone, and `useLocale()` returns `{ locale, locales, setLocale }`.
