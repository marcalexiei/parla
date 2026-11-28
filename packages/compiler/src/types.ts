import type { MessageInfo, ParamKind } from './compile.ts';

const IDENT = /^[A-Za-z_$][\w$]*$/;

const prop = (name: string): string => (IDENT.test(name) ? name : JSON.stringify(name));

function interfaceName(namespace: string): string {
  const pascal = namespace
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  // `_` keeps a name like `-` from becoming `Messages`, whose plain part would shadow `Text`
  return `${/^(?:\d|$)/.test(pascal) ? '_' : ''}${pascal}Messages`;
}

// Not valid as a `const` name in a module, or a built-in TypeScript rejects as one.
const RESERVED = new Set(
  'arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function globalThis if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof undefined var void while with yield'.split(
    ' ',
  ),
);

const isOwnName = (ns: string): boolean => IDENT.test(ns) && !RESERVED.has(ns);

/**
 * Each namespace's export: the name itself where it is an identifier, to match `t`'s key; else one
 * derived from its interface (`foo-bar` → `fooBar`), numbered around the names already taken.
 */
export function exportNames(ifaces: ReadonlyMap<string, string>): Map<string, string> {
  const names = new Map<string, string>();
  for (const ns of [...ifaces.keys()].filter((n) => isOwnName(n))) {
    names.set(ns, ns);
  }
  const used = new Set(names.values());
  for (const [ns, iface] of [...ifaces].filter(([n]) => !isOwnName(n))) {
    const base = iface.replace(/Messages$/, '');
    const camel = base.charAt(0).toLowerCase() + base.slice(1);
    const derived = RESERVED.has(camel) ? `_${camel}` : camel;
    let name = derived;
    for (let n = 2; used.has(name); n += 1) {
      name = `${derived}${n}`;
    }
    used.add(name);
    names.set(ns, name);
  }
  return names;
}

/** {@link interfaceName} per namespace, numbered where two collide (`foo-bar`, `foo_bar`). */
export function interfaceNames(namespaces: ReadonlyArray<string>): Map<string, string> {
  const names = new Map<string, string>();
  // its kind would shadow the imported `NamespaceKind`
  const used = new Set<string>(['NamespaceMessages']);
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

/** One params object: `names` typed by their uses, `selected` overriding a selector's type. */
function fields(
  info: MessageInfo,
  names: Iterable<string>,
  defaults: ReadonlySet<string>,
  selected?: [param: string, type: string],
): { fields: Array<string>; required: number } {
  const out = [...names]
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => {
      const type = name === selected?.[0] ? selected[1] : paramType(info.params.get(name) ?? []);
      return `${prop(name)}: ${type}`;
    });
  let required = out.length;
  for (const tag of [...info.markup].toSorted()) {
    if (!info.params.has(tag)) {
      const optional = defaults.has(tag);
      out.push(`${prop(tag)}${optional ? '?' : ''}: Markup<Node>`);
      required += optional ? 0 : 1;
    }
  }
  return { fields: out, required };
}

/** `defaults`: markup the runtime renders when a call leaves it out (the config's `markup`). */
export function signature(info: MessageInfo, defaults: ReadonlySet<string> = new Set()): string {
  const ret = info.rich ? 'Node' : 'string';
  const { branches } = info;
  if (branches) {
    // One member per key, so a key's own params are required only with it; `string` last.
    const every = new Set([...branches.needs.values()].flatMap((names) => [...names]));
    const members = [...branches.needs]
      .toSorted(
        ([a], [b]) => Number(a === null) - Number(b === null) || String(a).localeCompare(String(b)),
      )
      .map(([key, names]) => {
        // a plain `string` may hold any key, so it needs every branch's params
        const [type, needed] = key === null ? ['string', every] : [JSON.stringify(key), names];
        return `{ ${fields(info, needed, defaults, [branches.param, type]).fields.join('; ')} }`;
      });
    return `(params: ${members.join(' | ')}): ${ret}`;
  }
  const own = fields(info, info.params.keys(), defaults);
  if (own.fields.length === 0) {
    return info.rich ? '(): Node' : ': Text';
  }
  return `(params${own.required === 0 ? '?' : ''}: { ${own.fields.join('; ')} }): ${ret}`;
}

interface Leaf {
  readonly leaf: string;
  readonly doc?: string;
  readonly rich?: boolean;
}

interface Tree {
  [segment: string]: Tree | Leaf;
}

const isLeaf = (n: Tree[string]): n is Leaf => typeof (n as { leaf?: unknown }).leaf === 'string';

/** Whether `node` holds a message with markup (`rich`) or one without. */
const holds = (node: Tree[string], rich: boolean): boolean =>
  isLeaf(node) ? Boolean(node.rich) === rich : Object.values(node).some((n) => holds(n, rich));

function render(tree: Tree, indent: string): string {
  const lines: Array<string> = [];
  for (const [key, node] of Object.entries(tree)) {
    if (isLeaf(node)) {
      if (node.doc !== undefined) {
        lines.push(
          `${indent}/** ${node.doc.replaceAll('*/', String.raw`*\/`).replaceAll(/\s*\n\s*/g, ' ')} */`,
        );
      }
      lines.push(`${indent}${prop(key)}${node.leaf};`);
    } else {
      lines.push(`${indent}${prop(key)}: {`, render(node, `${indent}  `), `${indent}};`);
    }
  }
  return lines.join('\n');
}

export interface NamespaceTypes {
  /** The interfaces, without imports. */
  readonly code: string;
  /** Whether the namespace's interface takes `Node`: only markup needs it. */
  readonly generic: boolean;
  /** Whether `code` names `Text`. */
  readonly usesText: boolean;
}

function treeOf(entries: ReadonlyArray<[path: Array<string>, leaf: Leaf]>): Tree {
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

const pascal = (key: string): string =>
  key
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

/**
 * Plain messages in a non-generic `XText`, and those with markup in `XMessages<Node> extends XText`,
 * so instantiating `Node` skips every plain message. A group holding both splits the same way.
 */
function declare(
  tree: Tree,
  name: string,
  unique: (name: string) => string,
  out: Array<string>,
): void {
  const plain: Tree = {};
  const rich: Tree = {};
  for (const [key, node] of Object.entries(tree)) {
    if (!holds(node, true)) {
      plain[key] = node;
    } else if (isLeaf(node) || !holds(node, false)) {
      rich[key] = node;
    } else {
      const group = unique(name.replace(/Messages$/, `${pascal(key)}Messages`));
      declare(node, group, unique, out);
      rich[key] = { leaf: `: ${group}<Node>` };
    }
  }
  const text = name.replace(/Messages$/, 'Text');
  const body = (members: Tree): string => render(members, '  ');
  if (Object.keys(rich).length === 0) {
    out.push(`export interface ${name} {\n${body(plain)}\n}`);
  } else if (Object.keys(plain).length === 0) {
    out.push(`export interface ${name}<Node> {\n${body(rich)}\n}`);
  } else {
    out.push(
      `export interface ${text} {\n${body(plain)}\n}`,
      `export interface ${name}<Node> extends ${text} {\n${body(rich)}\n}`,
    );
  }
}

export function namespaceTypes(
  messages: Map<string, { info: MessageInfo; source: string }>,
  name: string,
  defaults: ReadonlySet<string>,
): NamespaceTypes {
  const leaves: Array<[Array<string>, Leaf]> = [...messages].map(([key, { info, source }]) => [
    key.split('.'),
    { leaf: signature(info, defaults), doc: source, rich: info.rich },
  ]);
  const tree = treeOf(leaves);
  const used = new Set([name]);
  const unique = (base: string): string => {
    let group = base;
    for (let n = 2; used.has(group); n += 1) {
      group = base.replace(/Messages$/, `${n}Messages`);
    }
    used.add(group);
    return group;
  };
  const out: Array<string> = [];
  declare(tree, name, unique, out);
  const code = out.join('\n\n');
  return {
    // One alias: TypeScript instantiates it once per node type, not once per tag. `export {}` keeps
    // it private, as a .d.ts otherwise exports every top-level name.
    code: code.includes('Markup<Node>')
      ? `type Markup<Node> = (children: Node) => Node;\n\n${code}\n\nexport {};`
      : code,
    generic: holds(tree, true),
    usesText: leaves.some(([, leaf]) => leaf.leaf === ': Text'),
  };
}
