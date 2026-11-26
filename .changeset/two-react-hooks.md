---
'@parlajs/react': minor
---

feat!: `useSuspenseParla` and `useParla` replace `useT`, take one namespace or several, and return `{ t, parla }`

Replace `const t = useT('ns')` with `const { t } = useSuspenseParla('ns')`; `useParla` no longer suspends and returns `ready`.
