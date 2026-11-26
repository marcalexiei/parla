# @parlajs/format-mf2

[MessageFormat 2](https://messageformat.unicode.org/) support for
[Parla](https://github.com/marcalexiei/parla). Parses and validates MF2 messages with
[`messageformat`](https://github.com/messageformat/messageformat).

Used by [`@parlajs/compiler`](../compiler) for namespaces with `"format": "mf2"`; you rarely
import it yourself.

Supported functions: `:number`, `:integer`, `:currency`, `:percent`, `:unit`, `:date`, `:time`,
`:datetime`, `:string`; `.input`/`.local` declarations, `.match` with several selectors, and
`{#tag}…{/tag}` markup.

## License

[MIT](./LICENSE)
