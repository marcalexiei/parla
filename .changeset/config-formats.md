---
'@parlajs/compiler': minor
'@parlajs/x18n-plugin': minor
---

feat!: custom formats go in `parla.config.ts` as `formats`, so the CLI and x18n read them too

Move `formats` from `build()` or the Vite plugin's options into the config.
