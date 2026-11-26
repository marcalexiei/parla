# Contributing to Parla

## Local Development

```bash
pnpm install
pnpm run build:packages
```

## Checks

```bash
pnpm run test       # unit tests
pnpm run lint       # oxlint
pnpm run typecheck  # tsc
pnpm check-all      # every check CI runs, cheapest failure first
```

`check-all` is the one to reach for before opening a pull request.

## Trying a Change in Another Project

```bash
pnpm pack:all
```

writes one tarball per package to `.packs/`. Point the other project at them with pnpm overrides:

```yaml
# pnpm-workspace.yaml of the other project
overrides:
  '@parlajs/core': file:../parla/.packs/parlajs-core-0.0.0.tgz
  '@parlajs/react': file:../parla/.packs/parlajs-react-0.0.0.tgz
  '@parlajs/compiler': file:../parla/.packs/parlajs-compiler-0.0.0.tgz
  '@parlajs/format-icu': file:../parla/.packs/parlajs-format-icu-0.0.0.tgz
  '@parlajs/format-mf2': file:../parla/.packs/parlajs-format-mf2-0.0.0.tgz
```

then `pnpm install --force` after each `pack:all`.
[parla-playground](https://github.com/marcalexiei/parla-playground) is set up this way.

## Changesets

A change to a published package carries a changeset:

```bash
pnpm exec changeset
```

The summary's first line is a conventional commit without a scope (`feat: …`, `fix: …`).

## Workflows That Commit

`pnpm install` installs a lefthook `pre-commit` hook that formats, lints and tests.
A workflow that commits sets `LEFTHOOK: 0` to skip it; the pull request it opens runs the full CI anyway.

## Any contributions you make will be under the MIT Software License

When you submit changes, your submissions are understood to be under the same
[MIT License](https://choosealicense.com/licenses/mit/) that covers the project.

## Report issues/bugs using GitHub's issues

Report a bug by [opening a new issue](https://github.com/marcalexiei/parla/issues/new).
