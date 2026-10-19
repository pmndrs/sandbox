import { parse } from 'acorn';
import MagicString from 'magic-string';
import { locate } from './oxc.ts';
import type { SourceMap } from './plugin.ts';
import type { ErrorLoc } from './protocol.ts';

/*
 * esm → vite's module-runner format. a port of vite's `ssrTransform` (MIT,
 * packages/vite/src/node/ssr/ssrTransform.ts) onto acorn + magic-string:
 *
 *   import { a } from './a'   →  const __vite_ssr_import_0__ = await __vite_ssr_import__("/a.ts", ...);
 *   a()                       →  (0,__vite_ssr_import_0__.a)()
 *   export const b = 1        →  __vite_ssr_exportName__("b", () => b) (hoisted) + const b = 1
 *   import.meta / import()    →  __vite_ssr_import_meta__ / __vite_ssr_dynamic_import__()
 *
 * imports stay live bindings (every reference reads through the module object),
 * which is why this needs scope analysis rather than a lexer.
 */

type Node = any;

const IMPORT = '__vite_ssr_import__';
const DYNAMIC_IMPORT = '__vite_ssr_dynamic_import__';
const EXPORT_ALL = '__vite_ssr_exportAll__';
const EXPORT_NAME = '__vite_ssr_exportName__';
const IMPORT_META = '__vite_ssr_import_meta__';
const EXPORT_DEFAULT = '__vite_ssr_export_default__';

/** syntax errors throw with a codeframe and a `loc` into `code`. */
export async function runnerTransform(
    code: string,
    id: string,
    resolve: (specifier: string) => Promise<string>,
): Promise<{ code: string; map: SourceMap }> {
    const ast = parseModule(code, id);
    const s = new MagicString(code);

    const specifiers = new Set<string>();
    const dynamicImports: Node[] = [];
    for (const node of ast.body) if (node.source) specifiers.add(node.source.value);
    traverse(ast, null, (node) => {
        if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string') {
            specifiers.add(node.source.value);
            dynamicImports.push(node);
        }
    });
    const ids = new Map(await Promise.all([...specifiers].map(async (spec) => [spec, await resolve(spec)] as const)));
    for (const node of dynamicImports) s.update(node.source.start, node.source.end, JSON.stringify(ids.get(node.source.value)));

    let uid = 0;
    const idToImportMap = new Map<string, string>();
    const declaredConst = new Set<string>();
    const fileStartIndex = /^#!.*\n/.exec(code)?.[0].length ?? 0;
    let hoistIndex = fileStartIndex;

    function defineImport(index: number, node: Node, importedNames?: string[]): string {
        const importId = `__vite_ssr_import_${uid++}__`;
        const metadata = importedNames?.length ? `, ${JSON.stringify({ importedNames })}` : '';
        s.update(
            node.start,
            node.end,
            `const ${importId} = await ${IMPORT}(${JSON.stringify(ids.get(node.source.value))}${metadata});\n`,
        );
        if (node.start === index) hoistIndex = node.end;
        else s.move(node.start, node.end, index);
        return importId;
    }

    function defineExport(name: string, local = name): void {
        s.appendLeft(fileStartIndex, `${EXPORT_NAME}(${JSON.stringify(name)}, () => { try { return ${local} } catch {} });\n`);
    }

    const imports: Node[] = [];
    const exports: Node[] = [];
    const reExportImportIdMap = new Map<Node, string>();
    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration') imports.push(node);
        else if (node.type === 'ExportDefaultDeclaration') exports.push(node);
        else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
            imports.push(node);
            exports.push(node);
        }
    }

    for (const node of imports) {
        if (node.type === 'ExportNamedDeclaration') {
            if (node.source) {
                const names = node.specifiers.map((spec: Node) => nameOf(spec.local));
                reExportImportIdMap.set(node, defineImport(hoistIndex, node, names));
            }
            continue;
        }
        if (node.type === 'ExportAllDeclaration') {
            reExportImportIdMap.set(node, defineImport(hoistIndex, node));
            continue;
        }
        const names = node.specifiers
            .map((spec: Node) =>
                spec.type === 'ImportSpecifier'
                    ? nameOf(spec.imported)
                    : spec.type === 'ImportDefaultSpecifier'
                      ? 'default'
                      : undefined,
            )
            .filter((name: string | undefined) => name !== undefined);
        const importId = defineImport(hoistIndex, node, names);
        for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') {
                idToImportMap.set(
                    spec.local.name,
                    spec.imported.type === 'Identifier'
                        ? `${importId}.${spec.imported.name}`
                        : `${importId}[${JSON.stringify(spec.imported.value)}]`,
                );
            } else if (spec.type === 'ImportDefaultSpecifier') idToImportMap.set(spec.local.name, `${importId}.default`);
            else idToImportMap.set(spec.local.name, importId);
        }
    }

    // export getters are defined up front so cycles see them.
    for (const node of exports) {
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                const declaration = node.declaration;
                if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
                    defineExport(declaration.id.name);
                } else {
                    for (const decl of declaration.declarations) for (const name of patternNames(decl.id)) defineExport(name);
                }
                s.remove(node.start, declaration.start);
            } else if (node.source) {
                const importId = reExportImportIdMap.get(node);
                for (const spec of node.specifiers) {
                    const local =
                        spec.local.type === 'Identifier' ? `.${spec.local.name}` : `[${JSON.stringify(spec.local.value)}]`;
                    defineExport(nameOf(spec.exported), `${importId}${local}`);
                }
            } else {
                s.remove(node.start, node.end);
                for (const spec of node.specifiers) {
                    const local = spec.local.name;
                    defineExport(nameOf(spec.exported), idToImportMap.get(local) ?? local);
                }
            }
        } else if (node.type === 'ExportDefaultDeclaration') {
            const declaration = node.declaration;
            // up to the end of `default` (not `declaration.start`: `export default (a)` loses its paren).
            const keywordEnd = code.indexOf('default', node.start) + 'default'.length;
            if (declaration.id && declaration.type !== 'FunctionExpression' && declaration.type !== 'ClassExpression') {
                // `export default function f() {}`: keep the (hoisted) declaration.
                s.remove(node.start, keywordEnd);
                defineExport('default', declaration.id.name);
            } else {
                s.update(node.start, keywordEnd, `const ${EXPORT_DEFAULT} =`);
                defineExport('default', EXPORT_DEFAULT);
            }
        } else if (node.type === 'ExportAllDeclaration') {
            const importId = reExportImportIdMap.get(node) as string;
            if (node.exported) defineExport(nameOf(node.exported), importId);
            else s.appendLeft(node.end, `${EXPORT_ALL}(${importId});\n`);
        }
    }

    walk(ast, {
        onStatements(statements) {
            // moved imports + rewritten references can glue statements together (asi): add the missing `;`s.
            for (let i = 0; i < statements.length - 1; i++) {
                const stmt = statements[i];
                if (
                    code[stmt.end - 1] !== ';' &&
                    stmt.type !== 'FunctionDeclaration' &&
                    stmt.type !== 'ClassDeclaration' &&
                    stmt.type !== 'BlockStatement' &&
                    stmt.type !== 'ImportDeclaration'
                ) {
                    s.appendLeft(stmt.end, ';');
                }
            }
        },
        onIdentifier(id, parent, parentStack) {
            const binding = idToImportMap.get(id.name);
            if (!binding) return;
            if (isStaticProperty(parent) && parent.shorthand) {
                // `{ a }` → `{ a: __vite_ssr_import_0__.a }`, but not in a declaration's pattern.
                if (!isNodeInPattern(parent) || isInDestructuringAssignment(parent, parentStack))
                    s.appendLeft(id.end, `: ${binding}`);
            } else if (parent.type === 'ClassDeclaration' && id === parent.superClass) {
                // class declarations hoist; their superclass must be a binding that exists up there.
                if (!declaredConst.has(id.name)) {
                    declaredConst.add(id.name);
                    const topNode = parentStack[parentStack.length - 2];
                    s.prependRight(topNode.start, `const ${id.name} = ${binding};\n`);
                }
            } else if (parent.type === 'CallExpression') {
                // `(0, ns.a)()`: call without `this` being the module object.
                if (id === parent.callee && !parent.optional) {
                    const argsStart = parent.arguments.length ? parent.arguments[0].start : parent.end;
                    s.update(id.start, argsStart, `(0,${binding})${code.slice(id.end, argsStart)}`);
                } else {
                    s.update(id.start, id.end, binding);
                    s.prependRight(id.start, '(0,');
                    s.appendLeft(id.end, ')');
                }
            } else if (!(parent.type === 'ClassExpression' && id === parent.id)) {
                s.update(id.start, id.end, binding);
            }
        },
        onImportMeta(node) {
            s.update(node.start, node.end, IMPORT_META);
        },
        onDynamicImport(node) {
            s.update(node.start, node.start + 6, DYNAMIC_IMPORT);
        },
    });

    const map = s.generateMap({ hires: 'boundary', source: id });
    return { code: s.toString(), map: { ...map, file: id } as SourceMap };
}

function parseModule(code: string, id: string): Node {
    try {
        return parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch (err) {
        const { message, pos } = err as SyntaxError & { pos?: number };
        if (pos === undefined) throw err;
        const error = new SyntaxError(`${id}: ${message}\n${codeframe(code, pos)}`) as SyntaxError & { loc?: ErrorLoc };
        error.loc = { file: id, ...locate(code, pos) };
        throw error;
    }
}

function codeframe(code: string, offset: number): string {
    const { line, column } = locate(code, offset);
    const lines = code.split('\n');
    const out: string[] = [];
    for (let n = Math.max(1, line - 2); n <= Math.min(lines.length, line + 2); n++) {
        out.push(`${n === line ? '>' : ' '} ${String(n).padStart(4)} | ${lines[n - 1]}`);
        if (n === line) out.push(`       | ${' '.repeat(column - 1)}^`);
    }
    return out.join('\n');
}

const nameOf = (node: Node): string => (node.type === 'Identifier' ? node.name : node.value);

function patternNames(pattern: Node): string[] {
    switch (pattern.type) {
        case 'Identifier':
            return [pattern.name];
        case 'ObjectPattern':
            return pattern.properties.flatMap((p: Node) => patternNames(p.type === 'RestElement' ? p : p.value));
        case 'ArrayPattern':
            return pattern.elements.flatMap((e: Node) => (e ? patternNames(e) : []));
        case 'RestElement':
            return patternNames(pattern.argument);
        case 'AssignmentPattern':
            return patternNames(pattern.left);
        default:
            return [];
    }
}

function traverse(
    node: Node,
    parent: Node,
    enter: (node: Node, parent: Node) => unknown,
    leave?: (node: Node, parent: Node) => void,
) {
    if (enter(node, parent) === false) return;
    for (const key in node) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child.type === 'string') traverse(child, node, enter, leave);
        } else if (value && typeof value.type === 'string') {
            traverse(value, node, enter, leave);
        }
    }
    leave?.(node, parent);
}

type Visitors = {
    onIdentifier(node: Node, parent: Node, parentStack: Node[]): void;
    onImportMeta(node: Node): void;
    onDynamicImport(node: Node): void;
    onStatements(statements: Node[]): void;
};

const patternNodes = new WeakSet<Node>();
const isNodeInPattern = (node: Node): boolean => patternNodes.has(node);

/** vite's scope walk (after @vue/compiler-core): reports identifiers not shadowed by a local binding. */
function walk(root: Node, { onIdentifier, onImportMeta, onDynamicImport, onStatements }: Visitors): void {
    const parentStack: Node[] = [];
    const varKindStack: string[] = [];
    const scopeMap = new WeakMap<Node, Set<string>>();
    const identifiers: [Node, Node[]][] = [];

    const setScope = (node: Node, name: string) => {
        const scopeIds = scopeMap.get(node) ?? new Set();
        scopeMap.set(node, scopeIds.add(name));
    };
    const isInScope = (name: string, parents: Node[]) => parents.some((node) => scopeMap.get(node)?.has(name));
    const handlePattern = (p: Node, parentScope: Node) => {
        for (const name of patternNames(p)) setScope(parentScope, name);
    };

    traverse(
        root,
        null,
        (node, parent) => {
            if (node.type === 'ImportDeclaration') return false;
            if (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock') onStatements(node.body);
            else if (node.type === 'SwitchCase') onStatements(node.consequent);

            if (parent && !isSkippedParent(node, parent)) parentStack.unshift(parent);
            if (node.type === 'VariableDeclaration') varKindStack.unshift(node.kind);

            if (node.type === 'MetaProperty' && node.meta.name === 'import') onImportMeta(node);
            else if (node.type === 'ImportExpression') onDynamicImport(node);

            if (node.type === 'Identifier') {
                if (!isInScope(node.name, parentStack) && isRefIdentifier(node, parent, parentStack)) {
                    identifiers.push([node, parentStack.slice(0)]);
                }
            } else if (isFunction(node)) {
                if (node.type === 'FunctionDeclaration') {
                    const parentScope = findParentScope(parentStack);
                    if (parentScope) setScope(parentScope, node.id.name);
                }
                if (node.type === 'FunctionExpression' && node.id) setScope(node, node.id.name);
                for (const p of node.params) handlePattern(p, node);
            } else if (node.type === 'ClassDeclaration') {
                const parentScope = findParentScope(parentStack);
                if (parentScope) setScope(parentScope, node.id.name);
            } else if (node.type === 'ClassExpression' && node.id) {
                setScope(node, node.id.name);
            } else if (node.type === 'Property' && parent.type === 'ObjectPattern') {
                patternNodes.add(node);
            } else if (node.type === 'VariableDeclarator') {
                const parentFunction = findParentScope(parentStack, varKindStack[0] === 'var');
                if (parentFunction) handlePattern(node.id, parentFunction);
            } else if (node.type === 'CatchClause' && node.param) {
                handlePattern(node.param, node);
            }
            return true;
        },
        (node, parent) => {
            if (parent && !isSkippedParent(node, parent)) parentStack.shift();
            if (node.type === 'VariableDeclaration') varKindStack.shift();
        },
    );

    // checked after the walk too: hoisted declarations later in a scope still shadow.
    for (const [node, stack] of identifiers) if (!isInScope(node.name, stack)) onIdentifier(node, stack[0], stack);
}

function isRefIdentifier(id: Node, parent: Node, parentStack: Node[]): boolean {
    if (parent.type === 'CatchClause') return false;
    if ((parent.type === 'VariableDeclarator' || parent.type === 'ClassDeclaration') && parent.id === id) return false;
    if (isFunction(parent) && (parent.id === id || parent.params.includes(id))) return false;
    if (parent.type === 'MethodDefinition' && !parent.computed) return false;
    if (parent.type === 'PropertyDefinition' && !parent.computed) return parent.value === id;
    if (isStaticProperty(parent) && parent.key === id) return false;
    if (isNodeInPattern(parent) && parent.value === id) return false;
    if (parent.type === 'ArrayPattern' && !isInDestructuringAssignment(parent, parentStack)) return false;
    if (parent.type === 'MemberExpression' && parent.property === id && !parent.computed) return false;
    if (
        (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') &&
        parent.label === id
    ) {
        return false;
    }
    if (parent.type === 'MetaProperty') return false;
    if (parent.type === 'ExportSpecifier' || parent.type === 'ExportAllDeclaration') return false;
    return id.name !== 'arguments';
}

const isStaticProperty = (node: Node): boolean => node.type === 'Property' && !node.computed;

const isFunction = (node: Node): boolean => /Function(?:Expression|Declaration)$|Method$/.test(node.type);

// else-branches (acorn nests them in the `if`) and a switch's discriminant (evaluated outside the cases) aren't in its scope.
const isSkippedParent = (node: Node, parent: Node): boolean =>
    (parent.type === 'IfStatement' && node === parent.alternate) ||
    (parent.type === 'SwitchStatement' && node === parent.discriminant);

const findParentScope = (parentStack: Node[], isVar = false): Node =>
    parentStack.find((node) =>
        isVar ? isFunction(node) : /^BlockStatement$|^SwitchStatement$|^For(?:In|Of)?Statement$/.test(node.type),
    );

const isInDestructuringAssignment = (parent: Node, parentStack: Node[]): boolean =>
    (parent.type === 'Property' || parent.type === 'ArrayPattern') &&
    parentStack.some((node) => node.type === 'AssignmentExpression');
