---
'@parlajs/core': patch
'@parlajs/react': patch
---

fix: `useT` always calls `use()`, which React requires once a component has suspended
