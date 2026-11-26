---
'@parlajs/react': minor
---

feat!: `useSuspenseParla` and `useParla` replace `useT`, take a list of namespaces, and return `{ t, parla }`

Replace `const t = useT('ns')` and `t.key()` with `const { t } = useSuspenseParla(['ns'])` and `t.ns.key()`; `useParla` no longer suspends and returns `ready`.
