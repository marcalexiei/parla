---
'@parlajs/core': minor
'@parlajs/react': minor
---

feat!: a message function takes one object, with the locale's fallback chain

`(value, options, locale) => …` becomes `({ value, options, locale, locales }) => …`, and
`createRuntime(locale, wrapRich, extensions, fallbacks, timeZone)` becomes
`createRuntime(locale, { wrapRich, functions, markup, fallbacks, timeZone })`.
