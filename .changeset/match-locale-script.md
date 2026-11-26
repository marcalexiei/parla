---
'@parlajs/core': patch
---

fix: `matchLocale` prefers the same script, then the same region: `zh-HK` picks `zh-TW` over `zh-CN`
