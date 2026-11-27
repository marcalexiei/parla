import type { MessageInfo, ParamKind } from './compile.ts';

const IDENT = /^[A-Za-z_$][\w$]*$/;

const prop = (name: string): string => (IDENT.test(name) ? name : JSON.stringify(name));

function interfaceName(namespace: string): string {
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
      fields.push(`${prop(tag)}${optional ? '?' : ''}: (children: Node) => Node`);
      required += optional ? 0 : 1;
    }
  }
  const ret = info.rich ? 'Node' : 'string';
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

export interface NamespaceTypes {
  readonly code: string;
  /** The interfaces `code` exports. */
  readonly names: ReadonlyArray<string>;
  /** Whether the namespace's interface takes `Node`: only markup needs it. */
  readonly generic: boolean;
}

function treeOf(entries: ReadonlyArray<[path: Array<string>, leaf: Tree[string]]>): Tree {
  const tree: Tree = {};
  for (const [path, leaf] of entries) {
    const last = path.at(-1) ?? '';
    let node = tree;
    for (const segment of path.slice(0, -1)) {
      let child = node[segment];
      if (!child || isLeaf(child)) {
        child = {};
        node[segment] = child;
      }
      node = child;
    }
    node[last] = leaf;
  }
  return tree;
}

/**
 * Plain messages in a non-generic `XText`, and those with markup in `XMessages<Node> extends XText`,
 * so a wider `t` checks against a narrower one without instantiating every plain message.
 */
export function namespaceTypes(
  messages: Map<string, { info: MessageInfo; source: string }>,
  name: string,
  defaults: ReadonlySet<string>,
): NamespaceTypes {
  const keys = [...messages.keys()];
  // A group goes whole into one interface: an extending interface cannot add to a base's group.
  const richTop = new Set(
    keys.filter((k) => messages.get(k)?.info.rich).map((k) => k.split('.')[0] ?? k),
  );
  const plain: Array<[Array<string>, Tree[string]]> = [];
  const rich: Array<[Array<string>, Tree[string]]> = [];
  for (const [key, { info, source }] of messages) {
    const path = key.split('.');
    const leaf = { leaf: signature(info, defaults), doc: source };
    (richTop.has(path[0] ?? key) ? rich : plain).push([path, leaf]);
  }
  const body = (entries: typeof plain): string => render(treeOf(entries), '  ');
  if (rich.length === 0) {
    return { code: `export interface ${name} {\n${body(plain)}\n}`, names: [name], generic: false };
  }
  if (plain.length === 0) {
    return {
      code: `export interface ${name}<Node> {\n${body(rich)}\n}`,
      names: [name],
      generic: true,
    };
  }
  const text = name.replace(/Messages$/, 'Text');
  return {
    code: `export interface ${text} {\n${body(plain)}\n}\n\nexport interface ${name}<Node> extends ${text} {\n${body(rich)}\n}`,
    names: [text, name],
    generic: true,
  };
}
