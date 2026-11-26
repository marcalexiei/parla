# AGENTS.md

Guidance for Claude Code in this repository. Durable rules live here; pending work lives in
`.claude/scratch/` (untracked).

## Before you change anything

- **A change to `packages/*` carries a changeset, unasked.** See [Changesets](#changesets).
- **Run `pnpm check-all` before handing work over**: it is every check CI runs.
- **Never hand-edit generated output** (`src/parla/` in a consumer, `.tmp/` in tests); change the
  compiler and rebuild.
- **Keep the rule files true**: fix a rule in the change that broke it, unasked.

## What this is

A pnpm monorepo for Parla: type-safe i18n with one accessor API (`t.cart.items({ count })`),
per-locale lazy loading, ICU and MessageFormat 2.

| Path                  | What it is                                                            |
| --------------------- | --------------------------------------------------------------------- |
| `packages/core`       | Runtime: locale state, lazy loading, `Intl` formatting, type registry |
| `packages/react`      | `ParlaProvider`, `useSuspenseParla`, `useParla`, `useLocale`          |
| `packages/compiler`   | `parla` CLI and Vite plugin: catalogs → per-locale chunks + `.d.ts`   |
| `packages/format-icu` | ICU MessageFormat → MF2 data model                                    |
| `packages/format-mf2` | MessageFormat 2 → MF2 data model                                      |
| `scripts/`            | Repo tooling such as `check-all.ts`, via `tsconfig.scripts.json`      |

The benchmark against i18next and other libraries lives in its own repo, `parla-benchmark`, so
its dependencies stay out of this workspace.

- **The MF2 data model is the one IR.** A format adapter only parses into it; everything after
  (compile, types, runtime) is format-blind. A new format is a new adapter, nothing else.
- **A chunk exports `($) => accessor`**: called once per locale with its `MessageRuntime`, it
  returns the nested tree of `(p) => …` messages in one object literal. `$`'s member names are
  short on purpose: they are repeated in every chunk.
- **Startup cost lives in the chunk factory**: a group past 127 keys is split, since V8 builds
  larger literals ~100× slower. Hoisting messages out of the factory was measured: no faster, and
  40% more gzip.
- **The runtime runs in browsers**: `core`, `react` and `format-*` read no Node globals
  (`no-restricted-globals` enforces it). Only `compiler` is Node-only.
- **Types reach a consumer through `Register`**: generated `catalog.d.ts` augments it with `locale`
  and `namespaces`, an adapter with `richNode`. The generated file augments the runtime module the
  package depends on (`@parlajs/react` before `@parlajs/core`, or the `runtime` config), since a
  package may not resolve `@parlajs/core` itself.
- **Each namespace has exactly one owner package**; a second owner is a build error, not a merge.
- **React has one API in two hooks**: `useSuspenseParla` suspends, `useParla` returns `ready`.
  Both take a list of namespaces, even for one, key `t` by namespace and return an object, so
  fields can join later; tooling such as the x18n scanner recognises only these two.

## Changesets

- **The first line is a conventional commit with no scope** (`feat: …`, `fix!: …`). The body is
  one or two lines a consumer must act on, or none.
- **Pre-1.0, a breaking change is `minor`.** A dependent package needs no entry of its own.
- **A tooling change that leaves the published output alone may go without one**: ask the owner.

## Commands

Run from the repo root.

```sh
pnpm test                 # vitest, whole workspace, one run (`pnpm exec vitest` watches)
pnpm test:coverage        # the same run, failing under a package's coverage floor
pnpm typecheck            # build, then tsc over the packages and scripts/
pnpm lint                 # oxlint over the whole workspace (`lint:ci` for GitHub annotations)
pnpm lint:fix             # oxlint --fix
pnpm lint:knip            # unused files/exports/deps
pnpm lint:publish         # attw + publint in each package
pnpm format               # oxfmt --write . (`format:check` in CI)
pnpm build:packages       # build packages/*
pnpm pack:all             # tarballs in .packs/, for trying Parla in another project
pnpm check-all            # every check CI runs, cheapest first (`-k` runs them all)
```

- **Keep `scripts/check-all.ts` in step with `.github/workflows/ci.yml`.**
- **`typecheck` builds first**: each `tsconfig.typecheck.json` resolves siblings through their
  `.d.ts`, as a consumer would.
- **The source condition is `@parlajs/source`**; vitest applies it only when it is also under
  `ssr.resolve.conditions`.

## TypeScript

TypeScript is **7.x**, with `oxlint-tsgolint` on the same major. The strict flags are in
`tsconfig.base.json`; the lint-enforced style is in `@marcalexiei/oxlint-config/typescript`.

- **A relative import names the `.ts` file**, through `allowImportingTsExtensions` and
  `rewriteRelativeImportExtensions`.
- **Interfaces declare members as properties** (`readonly load: (…) => …`), never methods, so a
  destructured or passed member is not an unbound method.
- **Never widen a signature to keep a test compiling; adapt the test.**
- **One export style per module: named.**
- **The build configs set `noCheck`**, so a green build proves nothing.

## Testing

- **A test that can pass without the code it covers is a bug**: break the code and watch it fail.
- **Generated-type tests run `tsc` over a fixture with `@ts-expect-error` lines** (`build.spec.ts`):
  an expected error that stops happening fails the run.
- **Fixtures go under `.tmp/`**, wiped at the start of the spec that writes them.
- **`test:coverage` fails under a package's floor in `vitest.config.coverage.ts`**: raise a floor
  after adding tests, lower one only with the owner.
- **React specs wrap work that resolves a load in an `await act(async …)`** that awaits the load
  itself; `findBy*` alone leaves a suspended tree unretried.

## Comments

**A comment states the reason, never the behaviour**, usually in one line. A doc block on an
exported declaration says what the type cannot: a fallback, ordering, unit or side effect.

## Linting and formatting

oxlint (type-aware) and oxfmt, extending `@marcalexiei/oxlint-config` and `@marcalexiei/oxfmt-config`.

- **Every local override carries its reason in `oxlint.config.ts`**; prefer a rule option to
  switching a rule off, and an inline disable carries its reason after `--`.
- **The autofixer is not a review**: typecheck, test and read the diff after `oxlint --fix`.

## Dependencies and pnpm

- **Renovate runs self-hosted from `.github/workflows/renovate.yml`**, configured by
  `.github/renovate.json5`; `postUpgradeTasks` writes a `patch` changeset for a `dependencies` bump
  in `packages/*`.
- **pnpm is 12.x**; `pnpm-workspace.yaml` gives each setting's reason. `allowBuilds` lists only
  packages still in the graph: check with `pnpm why <pkg>`.
- **`minimumReleaseAge` exempts the first-party configs alone, by name**, in pnpm and Renovate alike.
