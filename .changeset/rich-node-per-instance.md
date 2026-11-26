---
'@parlajs/compiler': minor
'@parlajs/core': minor
'@parlajs/react': minor
---

feat!: rich text's type follows the instance, so React and string instances share one catalog

Rebuild with `parla build`. `Register` and `RichNode` are gone: rich text is a `string` from
`@parlajs/core` (`Parla<Node>` for another node) and a `ReactNode` from `@parlajs/react`.
