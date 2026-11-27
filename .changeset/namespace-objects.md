---
'@parlajs/compiler': minor
'@parlajs/core': minor
'@parlajs/react': minor
---

feat!: namespaces are imported objects: `parla.load([checkout])`, `useParla([checkout])`, `Translations<typeof checkout>`

Import each namespace from `<outDir>/namespaces/<name>.js`, another package's from its build, and pass it instead of its name: `useParla(['checkout'])` becomes `useParla([checkout])` with `import { checkout } from './parla/namespaces/checkout.js'`, and `Translations<'checkout'>` becomes `Translations<typeof checkout>`. Each module exports the namespace under its own name (`scope_audit`), escaped only where that is no identifier (`foo-bar` → `fooBar`). `NamespaceRegistry`, `Namespaces` and `parla.register` are gone; `catalog` holds only the locales, and `createParla` takes it as `{ catalog }`.
