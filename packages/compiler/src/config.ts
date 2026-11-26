import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface NamespaceConfig {
  /** Message syntax: `icu` or `mf2`. */
  format: string;
  /** Catalog path relative to the owning package, with a `{locale}` token. */
  path: string;
}

/** `parla.config.json`, or the `parla` field of a package's `package.json`. */
export interface ParlaConfig {
  $schema?: string;
  locales?: string[];
  sourceLocale?: string;
  /** Extra fallback chain per locale; the source locale is always last. */
  fallbacks?: Record<string, string[]>;
  /** Where generated files go, relative to the config. Default `src/parla`. */
  outDir?: string;
  /** Namespaces this package owns. */
  namespaces?: Record<string, NamespaceConfig>;
  /** Workspace packages whose namespaces this package uses. Resolved from `node_modules`. */
  packages?: string[];
}

export interface ResolvedNamespace {
  name: string;
  format: string;
  /** Owning package name, or `.` for the config's own package. */
  owner: string;
  pathPattern: string;
  file(locale: string): string;
}

export interface ResolvedConfig {
  root: string;
  configFile: string;
  locales: string[];
  sourceLocale: string;
  fallbacks: Record<string, string[]>;
  outDir: string;
  namespaces: ResolvedNamespace[];
  /** Every file whose change should trigger a rebuild. */
  watchFiles: string[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`);
  }
}

function findPackageDir(name: string, from: string): string {
  let dir = from;
  while (true) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) throw new ConfigError(`Package "${name}" listed in "packages" was not found from ${from}`);
    dir = parent;
  }
}

/** Reads a config from `parla.config.json` or `package.json#parla` in `dir`. */
function readConfigAt(dir: string, explicit?: string): { file: string; config: ParlaConfig } | undefined {
  if (explicit) return { file: explicit, config: readJson(explicit) };
  const own = join(dir, 'parla.config.json');
  if (existsSync(own)) return { file: own, config: readJson(own) };
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    const field = readJson(pkg).parla;
    if (field) return { file: pkg, config: field };
  }
  return undefined;
}

export function loadConfig(cwd: string, configFile?: string): ResolvedConfig {
  const explicit = configFile ? resolve(cwd, configFile) : undefined;
  const found = readConfigAt(cwd, explicit);
  if (!found) throw new ConfigError(`No parla.config.json or package.json "parla" field in ${cwd}`);
  const root = dirname(found.file);
  const { config } = found;
  const sourceLocale = config.sourceLocale ?? 'en';
  const locales = config.locales ?? [sourceLocale];
  if (!locales.includes(sourceLocale)) throw new ConfigError(`sourceLocale "${sourceLocale}" is not in locales`);

  const namespaces = new Map<string, ResolvedNamespace>();
  const watchFiles = [found.file];
  const visited = new Set<string>();

  const collect = (dir: string, owner: string, cfg: ParlaConfig) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    for (const [name, ns] of Object.entries(cfg.namespaces ?? {})) {
      const existing = namespaces.get(name);
      if (existing) throw new ConfigError(`Namespace "${name}" is owned by both "${existing.owner}" and "${owner}"`);
      if (!ns.path?.includes('{locale}')) throw new ConfigError(`Namespace "${name}" path must contain {locale}`);
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
      if (!sub) throw new ConfigError(`Package "${pkgName}" has no "parla" field in its package.json`);
      watchFiles.push(sub.file);
      collect(pkgDir, pkgName, sub.config);
    }
  };
  collect(root, '.', config);

  const resolved = [...namespaces.values()];
  for (const ns of resolved) for (const l of locales) watchFiles.push(ns.file(l));

  return {
    root,
    configFile: found.file,
    locales,
    sourceLocale,
    fallbacks: config.fallbacks ?? {},
    outDir: resolve(root, config.outDir ?? 'src/parla'),
    namespaces: resolved,
    watchFiles,
  };
}

/** Locales to try, in order, when `locale` lacks a key. */
export function fallbackChain(config: ResolvedConfig, locale: string): string[] {
  const chain = [...(config.fallbacks[locale] ?? [])];
  const base = locale.split('-')[0]!;
  if (base !== locale && config.locales.includes(base) && !chain.includes(base)) chain.push(base);
  if (locale !== config.sourceLocale && !chain.includes(config.sourceLocale)) chain.push(config.sourceLocale);
  return chain.filter((l) => l !== locale);
}
