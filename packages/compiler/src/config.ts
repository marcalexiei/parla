import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { BUILTIN_FUNCTIONS } from './compile.ts';

export interface NamespaceConfig {
  /** Message syntax: `icu` or `mf2`. */
  format: string;
  /** Catalog path relative to the owning package, with a `{locale}` token. */
  path: string;
}

/** `parla.config.json`, or the `parla` field of a package's `package.json`. */
export type FunctionKind = 'string' | 'number' | 'date';

export interface ParlaConfig {
  $schema?: string;
  locales?: Array<string>;
  sourceLocale?: string;
  /** Extra fallback chain per locale; the source locale is always last. */
  fallbacks?: Record<string, Array<string>>;
  /** Where generated files go, relative to the config. Default `src/parla`. */
  outDir?: string;
  /** Namespaces this package owns. */
  namespaces?: Record<string, NamespaceConfig>;
  /** Workspace packages whose namespaces this package uses. Resolved from `node_modules`. */
  packages?: Array<string>;
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

function findPackageDir(name: string, from: string): string {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      // pnpm's isolated layout keeps a package's own deps beside its real path, not the symlink.
      return realpathSync(dirname(candidate));
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new ConfigError(`Package "${name}" listed in "packages" was not found from ${from}`);
    }
    dir = parent;
  }
}

/** Reads a config from `parla.config.json` or `package.json#parla` in `dir`. */
function readConfigAt(
  dir: string,
  explicit?: string,
): { file: string; config: ParlaConfig } | undefined {
  if (explicit) {
    return { file: explicit, config: readJson(explicit) as ParlaConfig };
  }
  const own = join(dir, 'parla.config.json');
  if (existsSync(own)) {
    return { file: own, config: readJson(own) as ParlaConfig };
  }
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    const field = (readJson(pkg) as PackageJson).parla;
    if (field) {
      return { file: pkg, config: field };
    }
  }
  return undefined;
}

const RUNTIMES = ['@parlajs/react', '@parlajs/core'];

function detectRuntime(dir: string): string {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) {
    return '@parlajs/core';
  }
  const pkg = readJson(file) as PackageJson;
  const deps = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
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

export function loadConfig(cwd: string, configFile?: string): ResolvedConfig {
  const explicit = configFile ? resolve(cwd, configFile) : undefined;
  const found = readConfigAt(cwd, explicit);
  if (!found) {
    throw new ConfigError(`No parla.config.json or package.json "parla" field in ${cwd}`);
  }
  const root = dirname(found.file);
  const { config } = found;
  const sourceLocale = config.sourceLocale ?? 'en';
  const locales = config.locales ?? [sourceLocale];
  if (!locales.includes(sourceLocale)) {
    throw new ConfigError(`sourceLocale "${sourceLocale}" is not in locales`);
  }

  const namespaces = new Map<string, ResolvedNamespace>();
  const watchFiles = [found.file];
  const visited = new Set<string>();
  const ownerDirs = new Map<string, string>();

  const collect = (dir: string, owner: string, cfg: ParlaConfig): void => {
    if (visited.has(dir)) {
      return;
    }
    visited.add(dir);
    for (const [name, ns] of Object.entries(cfg.namespaces ?? {})) {
      const existing = namespaces.get(name);
      if (existing?.owner === owner) {
        const copies = [ownerDirs.get(name) ?? root, dir].map((d) => relative(root, d)).join(', ');
        throw new ConfigError(
          `Two copies of "${owner}" provide namespace "${name}" (${copies}); install a single version`,
        );
      }
      if (existing) {
        throw new ConfigError(
          `Namespace "${name}" is owned by both "${existing.owner}" and "${owner}"`,
        );
      }
      ownerDirs.set(name, dir);
      if (!ns.path.includes('{locale}')) {
        throw new ConfigError(`Namespace "${name}" path must contain {locale}`);
      }
      namespaces.set(name, {
        name,
        format: ns.format,
        owner,
        pathPattern: ns.path,
        file: (locale) => resolve(dir, ns.path.replaceAll('{locale}', locale)),
      });
    }
    for (const pkgName of cfg.packages ?? []) {
      const pkgDir = findPackageDir(pkgName, dir);
      const sub = readConfigAt(pkgDir);
      if (!sub) {
        throw new ConfigError(`Package "${pkgName}" has no "parla" field in its package.json`);
      }
      watchFiles.push(sub.file);
      collect(pkgDir, pkgName, sub.config);
    }
  };
  collect(root, '.', config);

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
