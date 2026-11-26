import type { MessageInfo, ParamKind } from './compile.js';

const IDENT = /^[A-Za-z_$][\w$]*$/;

const prop = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));

export function interfaceName(namespace: string): string {
  const pascal = namespace
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
  return `${/^\d/.test(pascal) ? '_' : ''}${pascal}Messages`;
}

/** Collapses every use of one parameter into a single TS type. */
export function paramType(kinds: ParamKind[]): string {
  if (kinds.some((k) => k.kind === 'number')) return 'number';
  if (kinds.some((k) => k.kind === 'date')) return 'Date | number';
  const selects = kinds.filter((k) => k.kind === 'select');
  if (selects.length) {
    const keys = [...new Set(selects.flatMap((s) => s.keys))].map((k) => JSON.stringify(k));
    if (selects.some((s) => s.open)) keys.push('(string & {})');
    return keys.join(' | ') || 'string';
  }
  if (kinds.some((k) => k.kind === 'string')) return 'string';
  return 'string | number';
}

export function signature(info: MessageInfo): string {
  const fields = [...info.params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, kinds]) => `${prop(name)}: ${paramType(kinds)}`);
  for (const tag of [...info.markup].sort()) {
    if (!info.params.has(tag)) fields.push(`${prop(tag)}: (children: RichNode) => RichNode`);
  }
  const ret = info.rich ? 'RichNode' : 'string';
  return fields.length ? `(params: { ${fields.join('; ')} }): ${ret}` : `(): ${ret}`;
}

interface Tree {
  [segment: string]: Tree | { leaf: string; doc: string };
}

const isLeaf = (n: Tree[string]): n is { leaf: string; doc: string } => typeof (n as { leaf?: unknown }).leaf === 'string';

function render(tree: Tree, indent: string): string {
  const lines: string[] = [];
  for (const [key, node] of Object.entries(tree)) {
    if (isLeaf(node)) {
      lines.push(`${indent}/** ${node.doc.replaceAll('*/', '*\\/').replace(/\s*\n\s*/g, ' ')} */`);
      lines.push(`${indent}${prop(key)}${node.leaf};`);
    } else {
      lines.push(`${indent}${prop(key)}: {`, render(node, `${indent}  `), `${indent}};`);
    }
  }
  return lines.join('\n');
}

export function namespaceInterface(namespace: string, messages: Map<string, { info: MessageInfo; source: string }>): string {
  const tree: Tree = {};
  for (const [key, { info, source }] of messages) {
    const path = key.split('.');
    let node = tree;
    for (const segment of path.slice(0, -1)) node = (node[segment] ??= {}) as Tree;
    node[path.at(-1)!] = { leaf: signature(info), doc: source };
  }
  return `export interface ${interfaceName(namespace)} {\n${render(tree, '  ')}\n}`;
}
