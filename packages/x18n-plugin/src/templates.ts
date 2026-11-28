import { parseSync } from 'oxc-parser';

type Range = readonly [start: number, end: number];

/** `{expr}` in Svelte and Astro markup, past a block's keyword: `{#if expr}`, `{@html expr}`. */
function* braceExpressions(text: string): Generator<Range> {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') {
      continue;
    }
    let depth = 0;
    let quote: string | undefined;
    let j = i;
    for (; j < text.length; j += 1) {
      const c = text[j];
      if (quote) {
        if (c === '\\') {
          j += 1;
        } else if (c === quote) {
          quote = undefined;
        }
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    const keyword = /^\s*(?:[#:@/]\w+(?:\s+if)?)?/.exec(text.slice(i + 1, j))?.[0].length ?? 0;
    yield [i + 1 + keyword, j];
    i = j;
  }
}

const MUSTACHE = /\{\{(?<expr>[\s\S]*?)\}\}/g;
// `v-for` holds `item in items`, which is not an expression.
const DIRECTIVE =
  /\s(?::|@|v-bind:|v-on:|v-(?:if|else-if|show|html|text|model)\b)[\w.:-]*="(?<expr>[^"]*)"/g;

/** `{{ expr }}` and directive values in a Vue template. */
function* vueExpressions(text: string): Generator<Range> {
  for (const pattern of [MUSTACHE, DIRECTIVE]) {
    for (const match of text.matchAll(pattern)) {
      const expr = match.groups?.['expr'] ?? '';
      const start = match.index + match[0].lastIndexOf(expr);
      yield [start, start + expr.length];
    }
  }
}

const BLOCK = /<(?<tag>script|style)\b[^>]*>(?<body>[\s\S]*?)<\/\k<tag>>|<!--[\s\S]*?-->/g;
const FRONTMATTER = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/;

/** The parser's file name: Astro's markup is JSX, and a Vue or Svelte script is TypeScript. */
export const viewName = (path: string): string =>
  `${path}.${path.endsWith('.astro') ? 'tsx' : 'ts'}`;

/**
 * A Vue, Svelte or Astro file as one script, every character at its own offset: the scripts and
 * the template expressions that parse, joined by `;`, and blanks for the rest.
 */
export function scriptView(path: string, text: string): string {
  // By UTF-16 unit, as offsets count: a spread would split by code point.
  const view = Array.from({ length: text.length }, (_, i): string =>
    text[i] === '\n' ? '\n' : ' ',
  );
  const copy = (start: number, end: number): void => {
    for (let i = start; i < end; i += 1) {
      view[i] = text[i] ?? ' ';
    }
  };
  const blocks: Array<Range> = [];
  const frontmatter = path.endsWith('.astro') ? FRONTMATTER.exec(text) : null;
  for (const match of [...(frontmatter ? [frontmatter] : []), ...text.matchAll(BLOCK)]) {
    blocks.push([match.index, match.index + match[0].length]);
    const body = match.groups?.['body'];
    if (body !== undefined && match.groups?.['tag'] !== 'style') {
      const start = match.index + match[0].indexOf(body);
      copy(start, start + body.length);
    }
  }
  const name = viewName(path);
  const expressions = path.endsWith('.vue') ? vueExpressions(text) : braceExpressions(text);
  for (const [start, end] of expressions) {
    const inBlock = blocks.some(([from, to]) => from <= start && start < to);
    if (!inBlock && parseSync(name, `(${text.slice(start, end)})`).errors.length === 0) {
      copy(start, end);
      view[start - 1] = ';';
      view[end] = ';';
    }
  }
  return view.join('');
}
