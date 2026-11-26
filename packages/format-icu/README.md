# @parlajs/format-icu

ICU MessageFormat → MF2 data model, for [Parla](https://github.com/marcalexiei/parla)'s
compiler (`"format": "icu"`).

Supports placeholders, `plural` (`=N`, `offset`), `selectordinal`, `select`, `number`
(`::currency/EUR`, `percent`), `date`, `time`, `<tag>…</tag>` and the config's custom
`functions` (`{name, capitalize}`). Not `duration`. `'<` quotes up to the next `'`, as in FormatJS:
`'<option>'` is text, not markup.

## License

[MIT](./LICENSE)
