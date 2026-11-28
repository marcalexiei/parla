/**
 * @file The `react-server` entry: React's server build has no `createContext`, so Server Components
 * get `createParla` and the types without the hooks.
 */

import { createParla as createCoreParla } from '@parlajs/core';
import type {
  Namespace,
  Parla as CoreParla,
  ParlaOptions as CoreParlaOptions,
  Translations as CoreTranslations,
  WrapRich as CoreWrapRich,
} from '@parlajs/core';
import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';

// Named rather than `export *`, which would clash with this module's own exports.
export {
  createRuntime,
  matchLocale,
  parseAcceptLanguage,
  type Catalog,
  type FunctionName,
  type FunctionRegistry,
  type Loader,
  type Locale,
  type LocaleRegistry,
  type MarkupName,
  type MarkupRegistry,
  type MessageFactory,
  type MessageFunction,
  type MessageModule,
  type MessageRuntime,
  type Namespace,
  type NamespaceKind,
  type SelectorValue,
  type Text,
} from '@parlajs/core';

/* Core's types with rich text as a `ReactNode`. */
export type Parla = CoreParla<ReactNode>;
export type ParlaOptions = CoreParlaOptions<ReactNode>;
export type Translations<NS extends Namespace> = CoreTranslations<NS, ReactNode>;
export type WrapRich = CoreWrapRich<ReactNode>;

/** Children passed as arguments, so React does not ask for keys. */
const wrapRich: WrapRich = (parts) => createElement(Fragment, null, ...parts);

/** `createParla` from `@parlajs/core`, with rich text rendered as React nodes. */
export function createParla(options: ParlaOptions): Parla {
  return createCoreParla<ReactNode>({ wrapRich, ...options });
}
