---
'@parlajs/compiler': minor
---

feat!: an app builds only its own namespaces: `packages`, `parla types`, `types/` and the `package.json` `parla` field are gone

Build the owner package first and import its namespaces. Move a `package.json` `parla` field to `parla.config.ts`. An app that listed one shared package in `packages` can drop its config and import that package's `catalog.js`. Delete the old `src/parla/types/`.
