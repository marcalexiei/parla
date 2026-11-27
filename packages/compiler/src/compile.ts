// oxlint-disable max-classes-per-file -- the compiler, its error and its chunk scope belong together
import type { Model } from 'messageformat';

/** What a custom function's value is: it types the param. */
export type FunctionKind = 'string' | 'number' | 'date';

/** Message functions beyond the built-in ones, by what their value is. */
export type CustomFunctions = Readonly<Record<string, FunctionKind>>;

const NUMERIC = new Set(['number', 'integer', 'currency', 'percent', 'unit']);
const DATES = new Set(['date', 'time', 'datetime']);
/** The built-in message functions; the config's `functions` add to them. */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([...NUMERIC, ...DATES, 'string']);

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
  /**
   * Set when a `:string` selector's value decides which params a call needs: the params each key
   * needs, `null` for any other string. Unset when every key needs the same.
   */
  branches?: { param: string; needs: Map<string | null, Set<string>> };
}

export interface CompiledMessage {
  /** A function body reading params from `p` and the runtime from `$`. */
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

function kindOf(fn: Model.FunctionRef | undefined, custom: CustomKinds): ParamKind {
  if (!fn) {
    return { kind: 'any' };
  }
  const declared = custom.get(fn.name);
  if (declared) {
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

type CustomKinds = ReadonlyMap<string, FunctionKind>;

class MessageCompiler {
  private readonly vars = new Map<string, Binding>();
  private readonly scope: ModuleScope;
  private readonly custom: CustomKinds;
  readonly info: MessageInfo = { params: new Map(), markup: new Set(), rich: false };
  /** The params read outside any variant, and those the variant being compiled reads. */
  private readonly shared = new Set<string>();
  private reads: Set<string> | undefined;

  constructor(scope: ModuleScope, custom: CustomFunctions) {
    this.scope = scope;
    this.custom = new Map(Object.entries(custom));
  }

  private record(param: string, kind: ParamKind): void {
    const list = this.info.params.get(param) ?? [];
    list.push(kind);
    this.info.params.set(param, list);
    (this.reads ?? this.shared).add(param);
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
      if (!BUILTIN_FUNCTIONS.has(own.name) && !this.custom.has(own.name)) {
        throw new CompileError(`unknown function :${own.name}`);
      }
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
    const pick = `$.pick([${selectors.join(', ')}], ${this.scope.hoist(JSON.stringify(keys))})`;
    const reads: Array<Set<string>> = [];
    const codes = msg.variants.map((v) => {
      this.reads = new Set();
      reads.push(this.reads);
      return this.pattern(v.value).code;
    });
    this.reads = undefined;
    this.branch(msg, reads);
    // `one`/`other` is the commonest select, and a ternary a fraction of a switch's size.
    if (codes.length === 2) {
      const [first, second] = codes as [string, string];
      return `${pick} ? ${second} : ${first}`;
    }
    const cases = codes.map((code, i) => `case ${i}: return ${code};`);
    return `{ switch (${pick}) { ${cases.join(' ')} } }`;
  }

  /** Fills `info.branches` when exactly one selector is a `:string` param's. */
  private branch(msg: Model.SelectMessage, reads: ReadonlyArray<Set<string>>): void {
    const strings = msg.selectors.flatMap((sel, i) => {
      const b = this.resolve(sel.name);
      return b.fn?.name === 'string' && b.param ? [{ i, param: b.param }] : [];
    });
    const [only] = strings;
    const kinds = only && this.info.params.get(only.param);
    if (
      strings.length !== 1 ||
      !only ||
      kinds?.some((k) => k.kind !== 'select' && k.kind !== 'string' && k.kind !== 'any')
    ) {
      return;
    }
    const keyOf = (v: Model.Variant): string | null => {
      const key = v.keys[only.i];
      return !key || key.type === '*' ? null : key.value;
    };
    const readBy = (match: (v: Model.Variant) => boolean): Set<string> => {
      const out = new Set(this.shared);
      for (const [n, v] of msg.variants.entries()) {
        for (const param of match(v) ? (reads[n] ?? []) : []) {
          out.add(param);
        }
      }
      return out;
    };
    const needs = new Map<string | null, Set<string>>();
    for (const key of new Set(msg.variants.map(keyOf))) {
      if (key === null) {
        needs.set(
          null,
          readBy((v) => keyOf(v) === null),
        );
        continue;
      }
      // First, the selector decides alone where a variant has `*` for every other selector.
      const covered =
        only.i === 0 &&
        msg.variants.some(
          (v) => keyOf(v) === key && v.keys.every((k, j) => j === 0 || k.type === '*'),
        );
      needs.set(
        key,
        readBy((v) => keyOf(v) === key || (!covered && keyOf(v) === null)),
      );
    }
    const sets = [...needs.values()];
    if (sets.some((set) => set.size !== sets[0]?.size || [...set].some((p) => !sets[0]?.has(p)))) {
      this.info.branches = { param: only.param, needs };
    }
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
  return { body, info: c.info };
}
