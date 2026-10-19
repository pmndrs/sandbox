import { DEFAULT_CDN } from './esm-sh.ts';
import type { Dependencies } from './types.ts';

export type TypeFile = { path: string; content: string };

export type TypeAcquisition = { files: TypeFile[] };

// module-level so remounts / example switches reuse already-fetched types.
const typesUrlCache = new Map<string, string | null>();
const dtsCache = new Map<string, string | null>();

// esm.sh advertises a package's .d.ts url via the `x-typescript-types` header.
async function typesUrl(jsUrl: string): Promise<string | null> {
    const cached = typesUrlCache.get(jsUrl);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    try {
        const r = await fetch(jsUrl, { method: 'HEAD' });
        result = r.headers.get('x-typescript-types');
    } catch {
        result = null;
    }
    typesUrlCache.set(jsUrl, result);
    return result;
}

async function fetchText(url: string): Promise<string | null> {
    const cached = dtsCache.get(url);
    if (cached !== undefined) return cached;
    let text: string | null = null;
    try {
        const r = await fetch(url);
        if (r.ok) text = await r.text();
    } catch {
        text = null;
    }
    dtsCache.set(url, text);
    return text;
}

// `*` is esm.sh's all-external marker.
const stripCdn = (url: string): string => url.replace(/^https?:\/\/[^/]+\//, '').replace(/^\*/, '');

function splitPkg(rel: string): { pkgWithVer: string; rest: string } {
    const scoped = rel.startsWith('@');
    const s1 = rel.indexOf('/');
    const end = scoped ? rel.indexOf('/', s1 + 1) : s1;
    if (end === -1) return { pkgWithVer: rel, rest: '' };
    return { pkgWithVer: rel.slice(0, end), rest: rel.slice(end + 1) };
}

// types live under the package they type: `@types/react` → `react`, `@types/scope__name` → `@scope/name`.
function canonicalPkg(name: string): string {
    if (!name.startsWith('@types/')) return name;
    const bare = name.slice('@types/'.length);
    return bare.includes('__') ? `@${bare.replace('__', '/')}` : bare;
}

function pkgNameOf(url: string): string {
    const { pkgWithVer } = splitPkg(stripCdn(url));
    const at = pkgWithVer.lastIndexOf('@');
    return canonicalPkg(at > 0 ? pkgWithVer.slice(0, at) : pkgWithVer);
}

// esm.sh inserts an `X-<base64>` build segment after the package.
function subpathOf(url: string): string {
    return splitPkg(stripCdn(url)).rest.replace(/^X-[^/]+\//, '');
}

function importSpecs(content: string): string[] {
    const out = new Set<string>();
    for (const m of content.matchAll(/(?:from|import|export)\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
    for (const m of content.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
    // module augmentation (r3f's `declare module 'react' { namespace JSX … }`) arrives as an esm.sh url too.
    for (const m of content.matchAll(/declare\s+module\s+['"]([^'"]+)['"]/g)) out.add(m[1]);
    return [...out];
}

function referenceSpecs(content: string): string[] {
    const out = new Set<string>();
    for (const m of content.matchAll(/\/\/\/\s*<reference\s+(?:path|types)\s*=\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
    return [...out];
}

const dropDtsExt = (spec: string): string => spec.replace(/\.d\.[mc]?ts$/, '');

const replaceSpec = (content: string, from: string, to: string): string =>
    content.split(`"${from}"`).join(`"${to}"`).split(`'${from}'`).join(`'${to}'`);

type Job = { url: string; ownerPkg: string };

async function processOne(
    url: string,
    ownerPkg: string,
    enqueue: (url: string, ownerPkg: string) => void,
): Promise<TypeFile | null> {
    let content = await fetchText(url);
    if (content === null) return null;
    const vfsPath = `file:///node_modules/${ownerPkg}/${subpathOf(url)}`;

    // ts resolves triple-slash references literally, so their specifiers stay verbatim.
    for (const spec of referenceSpecs(content)) {
        if (spec.startsWith('.')) enqueue(new URL(spec, url).href, ownerPkg);
    }
    // ts won't resolve `from "./x.d.ts"`, and cross-package esm.sh urls must map to a bare path.
    for (const spec of importSpecs(content)) {
        if (spec.startsWith('.')) {
            enqueue(new URL(spec, url).href, ownerPkg);
            content = replaceSpec(content, spec, dropDtsExt(spec));
        } else if (/^https?:\/\//.test(spec)) {
            const name = pkgNameOf(spec);
            enqueue(spec, name);
            // `index` collapses to the bare name, so `declare module` augments the module users import.
            const sub = dropDtsExt(subpathOf(spec));
            content = replaceSpec(content, spec, sub === 'index' ? name : `${name}/${sub}`);
        }
        // bare specifiers are left as-is: resolved if that package is also acquired.
    }
    return { path: vfsPath, content };
}

// the file ceiling guards a pathological closure (three's is large).
const ATA_CONCURRENCY = 24;
const ATA_MAX_FILES = 2000;

export async function acquireTypes(dependencies: Dependencies, cdn = DEFAULT_CDN): Promise<TypeAcquisition> {
    const files: TypeFile[] = [];
    const seen = new Set<string>();
    const queue: Job[] = [];
    const enqueue = (url: string, ownerPkg: string): void => {
        if (!seen.has(url)) {
            seen.add(url);
            queue.push({ url, ownerPkg });
        }
    };

    // seed each dep's types entry + a package.json so a bare `import '<name>'` resolves
    // to it (even when the entry isn't `index.d.ts`, e.g. fiber's `dist/*.cjs.d.ts`).
    for (const [name, version] of Object.entries(dependencies)) {
        const dts = await typesUrl(`${cdn}/${name}@${version}`);
        if (dts === null) continue;
        files.push({
            path: `file:///node_modules/${name}/package.json`,
            content: JSON.stringify({ name, types: `./${subpathOf(dts)}` }),
        });
        enqueue(dts, name); // owner is the dep name, so @types/react types land under react
    }

    // three's tree is hundreds of files: sequential fetching never finishes, a fixed pool takes seconds.
    let active = 0;
    await new Promise<void>((resolve) => {
        const pump = (): void => {
            if (active === 0 && (queue.length === 0 || files.length >= ATA_MAX_FILES)) {
                resolve();
                return;
            }
            while (active < ATA_CONCURRENCY && queue.length > 0 && files.length < ATA_MAX_FILES) {
                const job = queue.shift() as Job;
                active++;
                processOne(job.url, job.ownerPkg, enqueue)
                    .then((f) => {
                        if (f) files.push(f);
                    })
                    .catch(() => {})
                    .finally(() => {
                        active--;
                        pump();
                    });
            }
        };
        pump();
    });

    return { files };
}
