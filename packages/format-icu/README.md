# @parlajs/format-icu

ICU MessageFormat support for [Parla](https://github.com/marcalexiei/parla). Parses ICU messages
into the MessageFormat 2 data model, which the compiler turns into code.

Used by [`@parlajs/compiler`](../compiler) for namespaces with `"format": "icu"`; you rarely
import it yourself.

Supported: placeholders, `plural` (with `=N` and `offset`), `selectordinal`, `select`,
`number` (including `::currency/EUR` skeletons and `percent`), `date`, `time`, and
`<tag>…</tag>` rich text. `duration` is not supported.

## License

[MIT](./LICENSE)
