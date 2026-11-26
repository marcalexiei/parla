import type { MessageInfo, ParamKind } from './compile.ts';

const IDENT = /^[A-Za-z_$][\w$]*$/;

const prop = (name: string): string => (IDENT.test(name) ? name : JSON.stringify(name));

export function interfaceName(namespace: string): string {
  const pascal = namespace
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return `${/^\d/.test(pascal) ? '_' : ''}${pascal}Messages`;
}

/** {@link interfaceName} per namespace, numbered where two collide (`foo-bar`, `foo_bar`). */
export function interfaceNames(namespaces: ReadonlyArray<string>): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const namespace of namespaces) {
    const base = interfaceName(namespace);
    let name = base;
    for (let n = 2; used.has(name); n += 1) {
      name = base.replace(/Messages$/, `${n}Messages`);
    }
    used.add(name);
    names.set(namespace, name);
  }
  return names;
}

/** Collapses every use of one parameter into a single TS type. */
export function paramType(kinds: Array<ParamKind>): string {
  if (kinds.some((k) => k.kind === 'number')) {
    return 'number';
  }
  if (kinds.some((k) => k.kind === 'date')) {
    return 'Date | number';
  }
  const selects = kinds.filter((k) => k.kind === 'select');
  if (selects.length > 0) {
    // sorted: a translation may list the variants in another order
    const keys = [...new Set(selects.flatMap((s) => s.keys))]
      .toSorted()
      .map((k) => JSON.stringify(k));
    if (selects.some((s) => s.open)) {
      keys.push('(string & {})');
    }
    return keys.join(' | ') || 'string';
  }
  if (kinds.some((k) => k.kind === 'string')) {
    return 'string';
  }
  return 'string | number';
}

/** `defaults`: markup the runtime renders when a call leaves it out (the config's `markup`). */
export function signature(info: MessageInfo, defaults: ReadonlySet<string> = new Set()): string {
  const fields = [...info.params.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, kinds]) => `${prop(name)}: ${paramType(kinds)}`);
  let required = fields.length;
  for (const tag of [...info.markup].toSorted()) {
    if (!info.params.has(tag)) {
      const optional = defaults.has(tag);
      fields.push(`${prop(tag)}${optional ? '?' : ''}: (children: RichNode) => RichNode`);
      required += optional ? 0 : 1;
    }
  }
  const ret = info.rich ? 'RichNode' : 'string';
  if (fields.length === 0) {
    return `(): ${ret}`;
  }
  return `(params${required === 0 ? '?' : ''}: { ${fields.join('; ')} }): ${ret}`;
}

interface Tree {
  [segment: string]: Tree | { leaf: string; doc: string };
}

const isLeaf = (n: Tree[string]): n is { leaf: string; doc: string } =>
  typeof (n as { leaf?: unknown }).leaf === 'string';

function render(tree: Tree, indent: string): string {
  const lines: Array<string> = [];
  for (const [key, node] of Object.entries(tree)) {
    if (isLeaf(node)) {
      lines.push(
        `${indent}/** ${node.doc.replaceAll('*/', String.raw`*\/`).replaceAll(/\s*\n\s*/g, ' ')} */`,
        `${indent}${prop(key)}${node.leaf};`,
      );
    } else {
      lines.push(`${indent}${prop(key)}: {`, render(node, `${indent}  `), `${indent}};`);
    }
  }
  return lines.join('\n');
}

export function namespaceInterface(
  namespace: string,
  messages: Map<string, { info: MessageInfo; source: string }>,
  options: { name?: string | undefined; defaults?: ReadonlySet<string> } = {},
): string {
  const { name = interfaceName(namespace), defaults = new Set<string>() } = options;
  const tree: Tree = {};
  for (const [key, { info, source }] of messages) {
    const path = key.split('.');
    const leaf = path.pop() ?? key;
    let node = tree;
    for (const segment of path) {
      let child = node[segment];
      if (!child || isLeaf(child)) {
        child = {};
        node[segment] = child;
      }
      node = child;
    }
    node[leaf] = { leaf: signature(info, defaults), doc: source };
  }
  return `export interface ${name} {\n${render(tree, '  ')}\n}`;
}
