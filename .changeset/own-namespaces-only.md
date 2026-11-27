---
'@parlajs/compiler': minor
---

feat!: an app builds only its own namespaces: `packages`, `parla types`, `types/` and the `package.json` `parla` field are gone

Build the owner package first and import its namespaces. Move a `package.json` `parla` field to `parla.config.ts`.
