---
'@parlajs/core': patch
---

perf: message functions find their `Intl` formatter without building a key, making plurals and numbers ~20% faster
