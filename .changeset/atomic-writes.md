---
'@parlajs/compiler': patch
---

fix: generated files are written through a rename, so parallel builds never read half a chunk
