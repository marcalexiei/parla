import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILTIN_FUNCTIONS } from './compile.ts';
import type { FunctionKind } from './compile.ts';

export interface NamespaceConfig {
  /** Message syntax: `icu` or `mf2`. */
  format: string;
  /** Catalog path relative to the owning package, with a `{locale}` token. */
  path: string;
}

/** `parla.config.ts`, or the `parla` field of a package's `package.json`. */
export interface ParlaConfig {
  locales?: Array<string>;
  sourceLocale?: string;
  /** Extra fallback chain per locale; the source locale is always last. */
  fallbacks?: Record<string, Array<string>>;
  /** Where generated files go, relative to the config. Default `src/parla`. */
  outDir?: string;
  /** Namespaces this package owns. */
  namespaces?: Record<string, NamespaceConfig>;
  /**
   * Packages whose namespaces this package uses, resolved from `node_modules`: a name for all of
   * them, `{ name, namespaces }` for a subset. `dependencies` walks the workspace-linked
   * `dependencies` instead, collecting every `parla` field.
   */
  packages?: Array<string | { name: string; namespaces: Array<string> }> | 'dependencies';
  /**
   * Message functions beyond the built-in ones, by what their value is. Each needs an
   * implementation in `createParla({ functions })`.
   */
  functions?: Record<string, FunctionKind>;
  /** Markup that calls may leave out: `createParla({ markup })` renders it. */
  markup?: Array<string>;
  /**
   * Module the generated types import and augment: the adapter this package depends on.
   * Default: the first of `@parlajs/react`, `@parlajs/core` listed in `package.json`.
   */
  runtime?: string;
}

export interface ResolvedNamespace {
  name: string;
  format: string;
  /** Owning package name, or `.` for the config's own package. */
  owner: string;
  pathPattern: string;
  readonly file: (locale: string) => string;
}

export interface ResolvedConfig {
  root: string;
  configFile: string;
  locales: Array<string>;
  sourceLocale: string;
  fallbacks: Record<string, Array<string>>;
  outDir: string;
  namespaces: Array<ResolvedNamespace>;
  /** Module the generated types import and augment. */
  runtime: string;
  functions: Record<string, FunctionKind>;
  markup: Array<string>;
  /** Every file whose change should trigger a rebuild. */
  watchFiles: Array<string>;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

interface PackageJson {
  parla?: ParlaConfig;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// Shapes are trusted: a malformed config fails later with a clear `ConfigError`.
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`);
  }
}

function findPackageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      // pnpm's isolated layout keeps a package's own deps beside its real path, not the symlink.
      return realpathSync(dirname(candidate));
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
}

const CONFIG_FILE = 'parla.config.ts';

/** Types a `parla.config.ts`: `export default defineConfig({ … })`. */
export function defineConfig(config: ParlaConfig): ParlaConfig {
  return config;
}

async function importConfig(file: string): Promise<ParlaConfig> {
  // The mtime busts Node's module cache, so a watcher sees an edited config.
  const url = `${pathToFileURL(file).href}?t=${statSync(file, { bigint: true }).mtimeNs}`;
  let mod: unknown;
  try {
    mod = await import(url);
  } catch (error) {
    throw new ConfigError(`Cannot load ${file}: ${(error as Error).message}`);
  }
  const config = (mod as { default?: unknown }).default;
  if (typeof config !== 'object' || config === null) {
    throw new ConfigError(`${file} must \`export default defineConfig({ … })\``);
  }
  return config;
}

function readPackageJson(dir: string): PackageJson | undefined {
  const file = join(dir, 'package.json');
  return existsSync(file) ? (readJson(file) as PackageJson) : undefined;
}

/** A package's `parla` field: packages are data, read from `node_modules` too. */
function readPackageConfig(dir: string): { file: string; config: ParlaConfig } | undefined {
  const field = readPackageJson(dir)?.parla;
  return field ? { file: join(dir, 'package.json'), config: field } : undefined;
}

/** `parla.config.ts`, or else the `parla` field of `package.json`. */
async function readProjectConfig(
  dir: string,
  explicit?: string,
): Promise<{ file: string; config: ParlaConfig } | undefined> {
  const file = explicit ?? join(dir, CONFIG_FILE);
  if (explicit || existsSync(file)) {
    return { file, config: await importConfig(file) };
  }
  return readPackageConfig(dir);
}

const RUNTIMES = ['@parlajs/react', '@parlajs/core'];

function detectRuntime(dir: string): string {
  const pkg = readPackageJson(dir);
  const deps = { ...pkg?.peerDependencies, ...pkg?.devDependencies, ...pkg?.dependencies };
  return RUNTIMES.find((name) => name in deps) ?? '@parlajs/core';
}

function checkFunctions(functions: Record<string, FunctionKind>): Record<string, FunctionKind> {
  const shadowing = Object.keys(functions).filter((name) => BUILTIN_FUNCTIONS.has(name));
  if (shadowing.length > 0) {
    throw new ConfigError(
      `"functions" cannot redefine the built-in ${shadowing.map((n) => `:${n}`).join(', ')}`,
    );
  }
  return functions;
}

/** Names that become path segments under `outDir`: no separators, no `..`. */
const NAMESPACE_NAME = /^[\w-]+(?:\.[\w-]+)*$/;
/** A BCP 47-like tag: `en`, `pt-BR`, `zh-Hant-TW`. */
const LOCALE_TAG = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

export async function loadConfig(cwd: string, configFile?: string): Promise<ResolvedConfig> {
  const explicit = configFile ? resolve(cwd, configFile) : undefined;
  const found = await readProjectConfig(cwd, explicit);
  if (!found) {
    throw new ConfigError(`No ${CONFIG_FILE} or package.json "parla" field in ${cwd}`);
  }
  const root = dirname(found.file);
  const { config } = found;
  const sourceLocale = config.sourceLocale ?? 'en';
  const locales = config.locales ?? [sourceLocale];
  for (const locale of locales) {
    if (!LOCALE_TAG.test(locale)) {
      throw new ConfigError(`Locale "${locale}" is not a locale tag such as "en" or "pt-BR"`);
    }
  }
  if (!locales.includes(sourceLocale)) {
    throw new ConfigError(`sourceLocale "${sourceLocale}" is not in locales`);
  }

  const watchFiles = [found.file];
  /** Each package once, in the order reached, with what includes it. */
  const owners = new Map<
    string,
    { name: string; config: ParlaConfig; all: boolean; subset: Set<string>; reached: boolean }
  >();
  const walked = new Set<string>();

  /** `all` for a name, the namespaces of a subset, or `reached` through `dependencies`. */
  const add = (
    dir: string,
    name: string,
    cfg: ParlaConfig,
    via: 'all' | 'reached' | ReadonlyArray<string>,
  ): void => {
    if (typeof via === 'object') {
      const unknown = via.filter((ns) => !Object.hasOwn(cfg.namespaces ?? {}, ns));
      if (unknown.length > 0) {
        throw new ConfigError(`Package "${name}" does not own namespace "${unknown.join('", "')}"`);
      }
    }
    let owner = owners.get(dir);
    const isNew = !owner;
    if (!owner) {
      owner = { name, config: cfg, all: false, subset: new Set(), reached: false };
      owners.set(dir, owner);
    }
    if (via === 'all') {
      owner.all = true;
    } else if (via === 'reached') {
      owner.reached = true;
    } else {
      for (const ns of via) {
        owner.subset.add(ns);
      }
    }
    if (!isNew) {
      return;
    }
    if (cfg.packages === 'dependencies') {
      // oxlint-disable-next-line eslint/no-use-before-define -- `add` and `walk` recurse into each other
      walk(dir);
      return;
    }
    for (const ref of cfg.packages ?? []) {
      const pkgName = typeof ref === 'string' ? ref : ref.name;
      const pkgDir = findPackageDir(pkgName, dir);
      if (!pkgDir) {
        throw new ConfigError(
          `Package "${pkgName}" listed in "packages" was not found from ${dir}`,
        );
      }
      const sub = readPackageConfig(pkgDir);
      if (!sub) {
        throw new ConfigError(`Package "${pkgName}" has no "parla" field in its package.json`);
      }
      watchFiles.push(sub.file);
      add(pkgDir, pkgName, sub.config, typeof ref === 'string' ? 'all' : ref.namespaces);
    }
  };

  // Workspace links only, passing through packages without a `parla` field.
  function walk(dir: string): void {
    if (walked.has(dir)) {
      return;
    }
    walked.add(dir);
    const pkg = readPackageJson(dir);
    for (const dep of Object.keys(pkg?.dependencies ?? {})) {
      const depDir = findPackageDir(dep, dir);
      if (!depDir || depDir.split(sep).includes('node_modules')) {
        continue;
      }
      watchFiles.push(join(depDir, 'package.json'));
      const sub = readPackageConfig(depDir);
      if (sub) {
        add(depDir, dep, sub.config, 'reached');
      }
      walk(depDir);
    }
  }

  add(root, '.', config, 'all');

  const namespaces = new Map<string, ResolvedNamespace>();
  const ownerDirs = new Map<string, string>();
  for (const [dir, owner] of owners) {
    // A subset listed anywhere narrows a package that is only reached as a dependency.
    const all = owner.all || (owner.reached && owner.subset.size === 0);
    for (const [name, ns] of Object.entries(owner.config.namespaces ?? {})) {
      if (!NAMESPACE_NAME.test(name)) {
        throw new ConfigError(
          `Namespace "${name}" must be letters, digits, "_", "-" or inner dots: it names files`,
        );
      }
      if (!all && !owner.subset.has(name)) {
        continue;
      }
      const existing = namespaces.get(name);
      if (existing?.owner === owner.name) {
        const copies = [ownerDirs.get(name) ?? root, dir].map((d) => relative(root, d)).join(', ');
        throw new ConfigError(
          `Two copies of "${owner.name}" provide namespace "${name}" (${copies}); install a single version`,
        );
      }
      if (existing) {
        throw new ConfigError(
          `Namespace "${name}" is owned by both "${existing.owner}" and "${owner.name}"`,
        );
      }
      if (!ns.path.includes('{locale}')) {
        throw new ConfigError(`Namespace "${name}" path must contain {locale}`);
      }
      ownerDirs.set(name, dir);
      namespaces.set(name, {
        name,
        format: ns.format,
        owner: owner.name,
        pathPattern: ns.path,
        file: (locale) => resolve(dir, ns.path.replaceAll('{locale}', locale)),
      });
    }
  }

  const resolved = [...namespaces.values()];
  for (const ns of resolved) {
    for (const l of locales) {
      watchFiles.push(ns.file(l));
    }
  }

  return {
    root,
    configFile: found.file,
    locales,
    sourceLocale,
    fallbacks: config.fallbacks ?? {},
    outDir: resolve(root, config.outDir ?? 'src/parla'),
    runtime: config.runtime ?? detectRuntime(root),
    functions: checkFunctions(config.functions ?? {}),
    markup: config.markup ?? [],
    namespaces: resolved,
    watchFiles,
  };
}

/** Locales to try, in order, when `locale` lacks a key. */
export function fallbackChain(config: ResolvedConfig, locale: string): Array<string> {
  const chain = [...(config.fallbacks[locale] ?? [])];
  const [base = locale] = locale.split('-');
  if (base !== locale && config.locales.includes(base) && !chain.includes(base)) {
    chain.push(base);
  }
  if (locale !== config.sourceLocale && !chain.includes(config.sourceLocale)) {
    chain.push(config.sourceLocale);
  }
  return chain.filter((l) => l !== locale);
}
