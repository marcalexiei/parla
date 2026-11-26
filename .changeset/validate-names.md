---
'@parlajs/compiler': patch
---

fix: namespace and locale names that would write files outside `outDir` (`../x`, `a/b`) are a config error
