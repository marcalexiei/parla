---
'@parlajs/compiler': minor
'@parlajs/core': minor
'@parlajs/react': minor
---

fix!: a package's generated types and the app's add up instead of clashing

Generated types now augment `LocaleRegistry`, `FunctionRegistry` and `MarkupRegistry`, one member
each, instead of `Register`. Rebuild with the matching `parla build`.
