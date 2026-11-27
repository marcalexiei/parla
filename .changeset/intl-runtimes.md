---
'@parlajs/core': minor
---

feat: runs on Hermes (React Native): `load` no longer needs `Array#toSorted`, a missing `Intl` API throws naming its polyfill, `matchLocale` compares subtags without `Intl.Locale` and accepts `it_IT`, and a bigint `NumberFormat` rejects prints as digits
