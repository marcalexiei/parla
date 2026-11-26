---
'@parlajs/core': patch
---

fix: the per-locale `Intl` formatter cache is bounded, so options bound to params no longer grow it forever
