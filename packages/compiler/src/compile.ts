// oxlint-disable max-classes-per-file -- the compiler, its error and its chunk scope belong together
import type { Model } from 'messageformat';

import type { FunctionKind } from './config.ts';

/** Message functions beyond the built-in ones, by what their value is. */
export type CustomFunctions = Readonly<Record<string, FunctionKind>>;

const NUMERIC = new Set(['number', 'integer', 'currency', 'percent', 'unit']);
const DATES = new Set(['date', 'time', 'datetime']);
/** The built-in message functions; the config's `functions` add to them. */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([...NUMERIC, ...DATES, 'string']);
const KNOWN = BUILTIN_FUNCTIONS;

/** What a message needs from one parameter. `any` is an unannotated placeholder. */
export type ParamKind =
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'string' }
  | { kind: 'any' }
  | { kind: 'select'; keys: Array<string>; open: boolean };

export interface MessageInfo {
  params: Map<string, Array<ParamKind>>;
  markup: Set<string>;
  rich: boolean;
}

export interface CompiledMessage {
  /** JS expression: `(p, $) => …`. */
  code: string;
  /** The function's body alone, reading params from `p` and the runtime from `$`. */
  body: string;
  info: MessageInfo;
}

export class CompileError extends Error {
  override name = 'CompileError';
}

/** Module-level constants shared by every message in one generated chunk. */
export class ModuleScope {
  readonly consts: Array<string> = [];
  private readonly seen = new Map<string, string>();
  hoist(code: string): string {
    let name = this.seen.get(code);
    if (!name) {
      name = `v${this.consts.length}`;
      this.consts.push(`const ${name} = ${code};`);
      this.seen.set(code, name);
    }
    return name;
  }
}

interface Binding {
  raw: string;
  fn?: Model.FunctionRef;
  param?: string;
}

function literalValue(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    // `02` would be a legacy octal literal: a syntax error in the chunk, which is a module
    return String(Number(value));
  }
  if (value === 'true' || value === 'false') {
    return value;
  }
  return JSON.stringify(value);
}

function kindOf(fn: Model.FunctionRef | undefined, custom: CustomFunctions): ParamKind {
  if (!fn) {
    return { kind: 'any' };
  }
  const declared = KNOWN.has(fn.name) ? undefined : custom[fn.name];
  if (declared && Object.hasOwn(custom, fn.name)) {
    return { kind: declared };
  }
  if (NUMERIC.has(fn.name)) {
    return { kind: 'number' };
  }
  if (DATES.has(fn.name)) {
    return { kind: 'date' };
  }
  return { kind: 'string' };
}

function checkFn(fn: Model.FunctionRef, custom: CustomFunctions): void {
  if (!KNOWN.has(fn.name) && !Object.hasOwn(custom, fn.name)) {
    throw new CompileError(`unknown function :${fn.name}`);
  }
}

class MessageCompiler {
  private readonly vars = new Map<string, Binding>();
  private readonly scope: ModuleScope;
  private readonly custom: CustomFunctions;
  readonly info: MessageInfo = { params: new Map(), markup: new Set(), rich: false };

  constructor(scope: ModuleScope, custom: CustomFunctions) {
    this.scope = scope;
    this.custom = custom;
  }

  private record(param: string, kind: ParamKind): void {
    const list = this.info.params.get(param) ?? [];
    list.push(kind);
    this.info.params.set(param, list);
  }

  private resolve(name: string): Binding {
    return this.vars.get(name) ?? { raw: `p[${JSON.stringify(name)}]`, param: name };
  }

  private options(fn: Model.FunctionRef): string {
    const entries = Object.entries(fn.options ?? {});
    if (entries.length === 0) {
      return '';
    }
    const parts = entries.map(
      ([k, v]) =>
        `${JSON.stringify(k)}: ${v.type === 'literal' ? literalValue(v.value) : this.resolve(v.name).raw}`,
    );
    const code = `{ ${parts.join(', ')} }`;
    const constant = entries.every(([, v]) => v.type === 'literal');
    return `, ${constant ? this.scope.hoist(code) : code}`;
  }

  private effective(expr: Model.Expression): Binding {
    let binding: Binding;
    if (expr.arg?.type === 'literal') {
      binding = { raw: JSON.stringify(expr.arg.value) };
    } else if (expr.arg?.type === 'variable') {
      binding = { ...this.resolve(expr.arg.name) };
    } else {
      binding = { raw: 'undefined' };
    }
    const own = expr.functionRef;
    if (own) {
      checkFn(own, this.custom);
      const inherited = binding.fn?.name === own.name ? binding.fn.options : undefined;
      binding.fn = inherited ? { ...own, options: { ...inherited, ...own.options } } : own;
    }
    return binding;
  }

  declare(decl: Model.Declaration): void {
    const binding = this.effective(decl.value);
    if (decl.type === 'input') {
      binding.param = decl.name;
    }
    this.vars.set(decl.name, binding);
    if (binding.param && binding.fn) {
      this.record(binding.param, kindOf(binding.fn, this.custom));
    }
  }

  private expression(expr: Model.Expression): string {
    const b = this.effective(expr);
    if (b.param) {
      this.record(b.param, kindOf(b.fn, this.custom));
    }
    if (!b.fn) {
      return `$.str(${b.raw})`;
    }
    return `$.f(${JSON.stringify(b.fn.name)}, ${b.raw}${this.options(b.fn)})`;
  }

  pattern(pattern: Model.Pattern): { code: string; rich: boolean } {
    const root: Array<string> = [];
    const stack: Array<{ name: string; items: Array<string> }> = [];
    let rich = false;
    const top = (): Array<string> => stack.at(-1)?.items ?? root;
    for (const part of pattern) {
      if (typeof part === 'string') {
        if (part) {
          top().push(JSON.stringify(part));
        }
      } else if (part.type === 'expression') {
        top().push(this.expression(part));
      } else {
        rich = true;
        this.info.markup.add(part.name);
        if (part.kind === 'open') {
          stack.push({ name: part.name, items: [] });
        } else if (part.kind === 'standalone') {
          top().push(`$.tag(p, ${JSON.stringify(part.name)}, [])`);
        } else {
          const open = stack.pop();
          if (open?.name !== part.name) {
            throw new CompileError(`closing markup {/${part.name}} has no matching open`);
          }
          top().push(`$.tag(p, ${JSON.stringify(part.name)}, [${open.items.join(', ')}])`);
        }
      }
    }
    const unclosed = stack.at(-1);
    if (unclosed) {
      throw new CompileError(`markup {#${unclosed.name}} is never closed`);
    }
    if (rich) {
      this.info.rich = true;
      return { code: `$.rich([${root.join(', ')}])`, rich };
    }
    return { code: root.length > 0 ? root.join(' + ') : '""', rich };
  }

  select(msg: Model.SelectMessage): string {
    const selectors = msg.selectors.map((sel, i) => {
      const b = this.resolve(sel.name);
      if (!b.fn) {
        throw new CompileError(
          `selector $${sel.name} needs an annotation such as :number or :string`,
        );
      }
      if (NUMERIC.has(b.fn.name)) {
        if (b.param) {
          this.record(b.param, { kind: 'number' });
        }
        return `$.sn(${b.raw}${this.options(b.fn)})`;
      }
      if (b.fn.name === 'string') {
        if (b.param) {
          const keys = new Set<string>();
          let open = false;
          for (const v of msg.variants) {
            const key = v.keys[i];
            if (key?.type === '*') {
              open = true;
            } else if (key) {
              keys.add(key.value);
            }
          }
          this.record(b.param, { kind: 'select', keys: [...keys], open });
        }
        return `$.ss(${b.raw})`;
      }
      throw new CompileError(`:${b.fn.name} cannot be used as a selector`);
    });
    const keys = msg.variants.map((v) => v.keys.map((k) => (k.type === '*' ? null : k.value)));
    const variants = this.scope.hoist(JSON.stringify(keys));
    const cases = msg.variants.map((v, i) => `case ${i}: return ${this.pattern(v.value).code};`);
    return `{ switch ($.pick([${selectors.join(', ')}], ${variants})) { ${cases.join(' ')} } }`;
  }
}

export function compileMessage(
  msg: Model.Message,
  scope: ModuleScope = new ModuleScope(),
  custom: CustomFunctions = {},
): CompiledMessage {
  const c = new MessageCompiler(scope, custom);
  for (const decl of msg.declarations) {
    c.declare(decl);
  }
  const body = msg.type === 'message' ? c.pattern(msg.pattern).code : c.select(msg);
  return { code: `(p, $) => ${body}`, body, info: c.info };
}
