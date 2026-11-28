# Contributing

```bash
pnpm install && pnpm build:packages
pnpm validate   # every check CI runs; run it before a pull request
```

A change to a published package carries a changeset (`pnpm exec changeset`); its first line is a
conventional commit without a scope.

## Trying a change in another project

`pnpm pack:all` writes tarballs to `.packs/`. Point the project at them, then
`pnpm install --force` after each pack:

```yaml
# pnpm-workspace.yaml
overrides:
  '@parlajs/core': file:../parla/.packs/parlajs-core-0.0.0.tgz
  '@parlajs/react': file:../parla/.packs/parlajs-react-0.0.0.tgz
  '@parlajs/compiler': file:../parla/.packs/parlajs-compiler-0.0.0.tgz
  '@parlajs/format-icu': file:../parla/.packs/parlajs-format-icu-0.0.0.tgz
  '@parlajs/format-mf2': file:../parla/.packs/parlajs-format-mf2-0.0.0.tgz
```

[parla-playground](https://github.com/marcalexiei/parla-playground) is set up this way.

## Workflows that commit

The lefthook `pre-commit` hook formats, lints and tests; a committing workflow sets `LEFTHOOK: 0`.

## License

Contributions are under the [MIT License](../LICENSE). Report bugs in
[issues](https://github.com/marcalexiei/parla/issues/new).
