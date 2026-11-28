import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { icu } from '@parlajs/format-icu';
import { mf2 } from '@parlajs/format-mf2';
import type { Model } from 'messageformat';

import { BUILTIN_FUNCTIONS } from './compile.ts';
import type { FunctionKind } from './compile.ts';

/** Parses one message into the MF2 data model, which the compiler reads. */
export interface FormatAdapter {
  readonly name: string;
  readonly parse: (source: string) => Model.Message;
}

export const defaultFormats: Readonly<Record<string, FormatAdapter>> = { icu, mf2 };

export interface NamespaceConfig {
  /** Message syntax: `icu`, `mf2` or a key of `formats`. */
  format: string;
  /** Catalog path relative to the config, with a `{locale}` token. */
  path: string;
}

export interface ParlaConfig {
  locales?: Array<string>;
  sourceLocale?: string;
  /** Extra fallback chain per locale; the source locale is always last. */
  fallbacks?: Record<string, Array<string>>;
  /** Where generated files go, relative to the config. Default `src/parla`. */
  outDir?: string;
  /** Namespaces this package owns: other packages import their built objects. */
  namespaces?: Record<string, NamespaceConfig>;
  /**
   * Message functions beyond the built-in ones, by what their value is. Each needs an
   * implementation in `createParla({ functions })`.
   */
  functions?: Record<string, FunctionKind>;
  /** Markup that calls may leave out: `createParla({ markup })` renders it. */
  markup?: Array<string>;
  /** Message syntaxes beyond `icu` and `mf2`, by the name a namespace's `format` gives. */
  formats?: Record<string, FormatAdapter>;
  /**
   * Module the generated types import and augment: the adapter this package depends on.
   * Default: the first of `@parlajs/react`, `@parlajs/core` listed in `package.json`.
   */
  runtime?: string;
}

export interface ResolvedNamespace {
  name: string;
  format: string;
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
  /** `icu`, `mf2` and the config's own `formats`. */
  formats: Record<string, FormatAdapter>;
  /** Every file whose change should trigger a rebuild. */
  watchFiles: Array<string>;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
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
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PackageJson) : undefined;
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
  const file = resolve(cwd, configFile ?? CONFIG_FILE);
  if (!configFile && !existsSync(file)) {
    throw new ConfigError(`No ${CONFIG_FILE} in ${cwd}`);
  }
  const config = await importConfig(file);
  const root = dirname(file);
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

  const namespaces: Array<ResolvedNamespace> = [];
  const watchFiles = [file];
  for (const [name, ns] of Object.entries(config.namespaces ?? {})) {
    if (!NAMESPACE_NAME.test(name)) {
      throw new ConfigError(
        `Namespace "${name}" must be letters, digits, "_", "-" or inner dots: it names files`,
      );
    }
    if (!ns.path.includes('{locale}')) {
      throw new ConfigError(`Namespace "${name}" path must contain {locale}`);
    }
    const resolved: ResolvedNamespace = {
      name,
      format: ns.format,
      file: (locale) => resolve(root, ns.path.replaceAll('{locale}', locale)),
    };
    namespaces.push(resolved);
    watchFiles.push(...locales.map((l) => resolved.file(l)));
  }

  return {
    root,
    configFile: file,
    locales,
    sourceLocale,
    fallbacks: config.fallbacks ?? {},
    outDir: resolve(root, config.outDir ?? 'src/parla'),
    runtime: config.runtime ?? detectRuntime(root),
    functions: checkFunctions(config.functions ?? {}),
    markup: config.markup ?? [],
    formats: { ...defaultFormats, ...config.formats },
    namespaces,
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
