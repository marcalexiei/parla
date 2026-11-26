import { mf1ToMessageData } from '@messageformat/icu-messageformat-1';
import { parse } from '@messageformat/parser';
import type { Model } from 'messageformat';

export interface FormatAdapter {
  /** Format id used in catalog config, e.g. `icu`. */
  name: string;
  /** Parses one message source into the MessageFormat 2 data model. Throws {@link FormatError}. */
  readonly parse: (source: string) => Model.Message;
}

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

const TAG = /<(?<close>\/?)(?<name>[A-Za-z][\w-]*)\s*(?<self>\/?)>/g;

/** Stands for a quoted `<` until tags are split; a private-use character no catalog contains. */
const LT = '\uE000';

/**
 * `'<` quotes up to the next `'` (FormatJS): `'<b>'` is the text `<b>`, not markup.
 * Inside, `{`, `}` and `#` are re-quoted for the ICU parser, which quotes only those.
 */
function quoteTags(source: string): string {
  return source.replaceAll(/'(?<quoted><(?:[^']|'')*)'/g, (...args) => {
    const { quoted = '' } = args.at(-1) as { quoted?: string };
    return quoted.replaceAll(/[{}#]/g, (c) => `'${c}'`).replaceAll('<', LT);
  });
}

/** ICU tags (`<link>…</link>`, a FormatJS convention) become MF2 markup. */
function splitTags(text: string): Model.Pattern {
  const out: Model.Pattern = [];
  const push = (slice: string): void => {
    out.push(slice.replaceAll(LT, '<'));
  };
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) {
      push(text.slice(last, m.index));
    }
    const { close, name = '', self } = m.groups ?? {};
    let kind: Model.Markup['kind'] = 'open';
    if (close) {
      kind = 'close';
    } else if (self) {
      kind = 'standalone';
    }
    out.push({ type: 'markup', kind, name });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    push(text.slice(last));
  }
  return out;
}

function stripMf1Options(options: Model.Options | undefined): Model.Options {
  const out: Model.Options = {};
  for (const [k, v] of Object.entries(options ?? {})) {
    if (!k.startsWith('mf1:')) {
      out[k] = v;
    }
  }
  return out;
}

/** Maps `:mf1:*` functions emitted by the converter onto Parla's canonical function set. */
function normalizeFunction(fn: Model.FunctionRef): Model.FunctionRef {
  const options = stripMf1Options(fn.options);
  switch (fn.name) {
    case 'mf1:number':
    case 'mf1:plural':
      return { type: 'function', name: 'number', options };
    case 'mf1:currency':
      return { type: 'function', name: 'currency', options };
    case 'mf1:date':
      return { type: 'function', name: 'date', options };
    case 'mf1:time':
      return { type: 'function', name: 'time', options };
    case 'mf1:unit': {
      const { unit } = options;
      if (unit?.type === 'literal' && unit.value === 'percent') {
        delete options['unit'];
        return { type: 'function', name: 'percent', options };
      }
      return { type: 'function', name: 'unit', options };
    }
    case 'mf1:duration':
      throw new FormatError('ICU `duration` is not supported');
    default:
      // A custom function (`{x, capitalize}`): the compiler checks it against the config.
      return { ...fn, name: fn.name.replace(/^mf1:/, ''), options };
  }
}

function normalizeExpression<E extends Model.Expression>(expr: E): E {
  const { attributes: _drop, ...rest } = expr;
  return (
    rest.functionRef ? { ...rest, functionRef: normalizeFunction(rest.functionRef) } : rest
  ) as E;
}

function normalizePattern(pattern: Model.Pattern): Model.Pattern {
  const out: Model.Pattern = [];
  for (const part of pattern) {
    if (typeof part === 'string') {
      out.push(...splitTags(part));
    } else if (part.type === 'expression') {
      out.push(normalizeExpression(part));
    } else {
      out.push(part);
    }
  }
  return out;
}

function normalize(msg: Model.Message): Model.Message {
  const declarations = msg.declarations.map((d) => ({
    ...d,
    value: normalizeExpression(d.value),
  })) as Array<Model.Declaration>;
  if (msg.type === 'message') {
    return { type: 'message', declarations, pattern: normalizePattern(msg.pattern) };
  }
  return {
    type: 'select',
    declarations,
    selectors: msg.selectors,
    variants: msg.variants.map((v) => ({ keys: v.keys, value: normalizePattern(v.value) })),
  };
}

export const icu: FormatAdapter = {
  name: 'icu',
  parse(source) {
    let ast;
    try {
      ast = parse(quoteTags(source), { strict: false });
    } catch (error) {
      throw new FormatError(`ICU ${(error as Error).message}`);
    }
    return normalize(mf1ToMessageData(ast));
  },
};
