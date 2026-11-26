---
'@parlajs/compiler': minor
'@parlajs/core': minor
---

feat!: a chunk builds its accessor in one call, making a cold load about 6× faster

Rebuild with the matching `parla build`: core no longer reads the old chunk format.
