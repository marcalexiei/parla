# AGENTS.md

Rules for agents in this repo. Pending work lives in `.claude/scratch/` (untracked).

## Always

- **A change to `packages/*` carries a changeset, unasked.**
- **Run `pnpm check-all` before handing work over**: it is every CI check.
- **Never hand-edit generated output** (`src/parla/`, `.tmp/`): change the compiler and rebuild.
- **Keep these rules true**: fix one in the change that breaks it.
- **Keep text short**: docs, comments and changesets; cut what code or a table shows.

## Layout

| Path                  |                                                            |
| --------------------- | ---------------------------------------------------------- |
| `packages/core`       | Runtime: locale state, lazy loading, `Intl`, registries    |
| `packages/react`      | `ParlaProvider`, `useParla`, `useLocale`                   |
| `packages/compiler`   | `parla` CLI and Vite plugin: catalogs → chunks + `.d.ts`   |
| `packages/format-icu` | ICU → MF2 data model                                       |
| `packages/format-mf2` | MF2 → MF2 data model                                       |
| `scripts/`            | Repo tooling (`check-all.ts`), via `tsconfig.scripts.json` |

The benchmark lives in `parla-benchmark`, keeping its dependencies out of here.

## Design

- **One function per job, one way to call it**: `parla.load(ns[])` and `useParla(ns[])` take a
  list, even of one, and return `t` keyed by namespace. Tooling such as x18n reads only these.
- **`t` is the proof of loading**: it has only the loaded namespaces; a child takes
  `Translations<'ns'>` and a wider `t` satisfies it. No `ready` flags, no unchecked getters.
- **The MF2 data model is the one IR**: a format adapter only parses into it.
- **A chunk exports `($) => accessor`**, one object literal; `$`'s members are short because every
  chunk repeats them.
- **V8 builds literals past 127 keys ~100× slower**, so bigger groups are split. Hoisting messages
  out of the factory measured no faster and 40% more gzip.
- **`core`, `react` and `format-*` run in browsers**: no Node globals (`no-restricted-globals`).
- **Types reach consumers through registries**: `catalog.d.ts` augments the runtime the package
  depends on (`@parlajs/react` before `@parlajs/core`, or `runtime`), one member per locale,
  namespace, function or tag, so a package's types and the app's add up instead of clashing.
- **A namespace has one owner package**; a second is a build error.

## Commands

```sh
pnpm test             # vitest, once (`pnpm exec vitest` watches)
pnpm test:coverage    # fails under a floor in vitest.config.coverage.ts
pnpm typecheck        # builds, then tsc
pnpm lint             # oxlint (`lint:fix`, `lint:knip`, `lint:publish`, `lint:lib-check`)
pnpm format           # oxfmt
pnpm pack:all         # tarballs in .packs/
pnpm check-all        # every CI check, cheapest first (`-k` keeps going)
```

- **Keep `scripts/check-all.ts` in step with `.github/workflows/ci.yml`.**
- **`typecheck` builds first**: packages resolve siblings through their `.d.ts`.
- **The source condition is `@parlajs/source`**; vitest needs it in `ssr.resolve.conditions` too.

## Changesets

- **First line: a conventional commit, no scope** (`feat!: …`). Body: what a consumer must do, or
  nothing.
- **Pre-1.0, breaking is `minor`.** Dependents need no entry.
- **A tooling-only change may skip one**: ask the owner.

## TypeScript

TypeScript **7.x**, `oxlint-tsgolint` on the same major; strict flags in `tsconfig.base.json`.

- **Relative imports name the `.ts` file.**
- **Interface members are properties** (`readonly load: (…) => …`), never methods.
- **Never widen a signature for a test; adapt the test.**
- **Consumers may keep `skipLibCheck: false`**: so does this repo, every type test, and
  `lint:lib-check`, which type-checks the built packages and a generated catalog as an app would.
- **Named exports only.**
- **Build configs set `noCheck`**: a green build proves nothing.

## Tests

- **A test that passes without its code is a bug**: break the code, watch it fail.
- **Type tests run `tsc` over fixtures with `@ts-expect-error`** (`build.spec.ts`).
- **Fixtures go under `.tmp/`**, wiped by the spec that writes them.
- **Raise a coverage floor after adding tests; lower one only with the owner.**
- **React specs resolve loads inside `await act(async …)`**; `findBy*` alone leaves a suspended
  tree unretried.

## Comments

**State the reason, not the behaviour**, in one line. Doc blocks say what the type cannot.

## Lint and format

oxlint (type-aware) and oxfmt, from `@marcalexiei/oxlint-config` and `@marcalexiei/oxfmt-config`.

- **Each override carries its reason in `oxlint.config.ts`**; an inline disable, after `--`.
- **Read the diff after `oxlint --fix`**, then typecheck and test.

## Dependencies

- **Renovate runs self-hosted** (`.github/workflows/renovate.yml`, `.github/renovate.json5`) and
  writes a `patch` changeset for a `dependencies` bump in `packages/*`.
- **pnpm 12.x**; `pnpm-workspace.yaml` gives each setting's reason. `allowBuilds` lists only
  packages still in the graph (`pnpm why <pkg>`).
- **`minimumReleaseAge` exempts only the first-party configs, by name**, in pnpm and Renovate.
