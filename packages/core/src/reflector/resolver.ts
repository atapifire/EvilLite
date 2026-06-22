/*! EvilLite Reflector — resolver (Layer 2)
 *
 * Turns the captured registry of minified game classes into named hooks, in a way
 * that survives EvilQuest bundle updates. No AST parsing: we inspect the LIVE classes
 * that the capture layer registered into `document.client` (name -> Class), plus the
 * index-aligned chunk URLs in `window.__eqSourceUrls` / `window.__eqSourceModules`.
 *
 * Entry-point discovery is a 3-tier cascade (each more general, less precise):
 *   1. chunk-name anchor  — match the chunk filename the class ships in
 *                           (GameManager-<hash>.js; [name] stable, hash rotates). Fast.
 *   2. import-graph walk  — if (1) misses (EQ stopped naming chunks), parse the entry
 *                           chunk's dynamic `import("./X.js")` edges, narrow to the
 *                           classes in those boot-imported chunks, then fuzzy-pick.
 *   3. all-classes fuzzy  — last resort: fuzzy N-of-M over the whole registry.
 *
 * Leaf classes (no `chunk`) just use tier 3 directly.
 */

export interface Signature {
    /** Distinctive prototype members (methods + getters) for fuzzy matching. */
    members?: string[];
    /** Fraction of `members` that must be present. Default 0.6. */
    threshold?: number;
    /** Structural anchor: identify the class by the chunk filename it ships in. */
    chunk?: RegExp;
}

export interface ResolveResult {
    name: string;
    cls: any | null;
    /** 'chunk' | 'import-graph' | 'fuzzy' | 'none' | 'ambiguous' — diagnostics. */
    via: string;
    /** Minified key it resolved to (rotates every build; diagnostics only). */
    key?: string;
}

type ClientRegistry = Map<string, any>;
interface Candidate { key: string; cls: any; }

const g = () => globalThis as any;

/** Union of all member names across a class's prototype chain (methods + getters). */
export function classMembers(cls: any): Set<string> {
    const out = new Set<string>();
    let proto = cls?.prototype;
    while (proto && proto !== Object.prototype) {
        for (const n of Object.getOwnPropertyNames(proto)) {
            if (n !== 'constructor') out.add(n);
        }
        proto = Object.getPrototypeOf(proto);
    }
    return out;
}

/** Bare filename (no path, no query) of a chunk URL. */
function fileOf(url: string): string {
    return (url.split('/').pop() ?? '').split('?')[0];
}

/** Live classes declared in captured chunk i, looked up in the runtime registry. */
function classesInModule(i: number, client: ClientRegistry): Candidate[] {
    const mods: string[] = g().__eqSourceModules ?? [];
    const out: Candidate[] = [];
    for (const m of (mods[i] ?? '').matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)) {
        const cls = client.get(m[1]);
        if (cls) out.push({ key: m[1], cls });
    }
    return out;
}

/** TIER 1 — classes declared in any captured chunk whose URL matches `re`. */
export function classesInChunk(re: RegExp, client: ClientRegistry): Candidate[] {
    const urls: string[] = g().__eqSourceUrls ?? [];
    const out: Candidate[] = [];
    for (let i = 0; i < urls.length; i++) {
        if (re.test(urls[i])) out.push(...classesInModule(i, client));
    }
    return out;
}

/**
 * TIER 2 — the import-graph walk. Find the entry/boot chunk (the one that defines the Vite
 * `__vite__mapDeps` manifest, i.e. `index-*.js`), read the chunk filenames it dynamically
 * `import("./X.js")`s, and return the classes declared in exactly those boot-imported chunks.
 *
 * This is the same idea as matching on the chunk NAME, but one level more robust: instead of
 * trusting that the chunk is *named* "GameManager", we trust that the entry *boots* it via a
 * dynamic import — which is true even if EQ ships hash-only chunk names. The signature (tier-3
 * fuzzy, applied to this narrowed set by the caller) then picks the right one among them.
 */
export function classesViaImportGraph(client: ClientRegistry): Candidate[] {
    const urls: string[] = g().__eqSourceUrls ?? [];
    const mods: string[] = g().__eqSourceModules ?? [];

    // entry chunk = the one carrying the Vite dep manifest; fall back to index-*.js by URL.
    let entryIdx = mods.findIndex((m) => /__vite__mapDeps\s*=/.test(m));
    if (entryIdx < 0) entryIdx = urls.findIndex((u) => /\/index-[\w]+\.js(\?|$)/.test(u));
    if (entryIdx < 0) return [];

    // chunk filenames the entry dynamically imports: import("./Foo-hash.js")
    const wanted = new Set<string>();
    for (const m of (mods[entryIdx] ?? '').matchAll(/import\(\s*["']\.?\/?([^"']+\.js)["']\s*\)/g)) {
        wanted.add(fileOf(m[1]));
    }
    if (!wanted.size) return [];

    // classes declared in those boot-imported chunks
    const out: Candidate[] = [];
    for (let i = 0; i < urls.length; i++) {
        if (wanted.has(fileOf(urls[i]))) out.push(...classesInModule(i, client));
    }
    return out;
}

/** Fuzzy N-of-M over a candidate list. Returns the unique best, or null (logging ambiguity). */
function fuzzyPick(name: string, sig: Signature, candidates: Iterable<Candidate>): ResolveResult {
    const members = sig.members ?? [];
    if (!members.length) return { name, cls: null, via: 'none' };
    const need = Math.ceil((sig.threshold ?? 0.6) * members.length);

    const scored: { key: string; cls: any; score: number }[] = [];
    for (const { key, cls } of candidates) {
        const have = classMembers(cls);
        if (!have.size) continue;
        let score = 0;
        for (const m of members) if (have.has(m)) score++;
        if (score >= need) scored.push({ key, cls, score });
    }
    if (!scored.length) return { name, cls: null, via: 'none' };
    scored.sort((a, b) => b.score - a.score);
    if (scored.length > 1 && scored[0].score === scored[1].score) {
        // eslint-disable-next-line no-console
        console.error(`[Reflector] AMBIGUOUS ${name} -> ${scored.slice(0, 3).map((s) => s.key).join(', ')}`);
        return { name, cls: null, via: 'ambiguous' };
    }
    return { name, cls: scored[0].cls, via: 'fuzzy', key: scored[0].key };
}

/** Resolve one signature to exactly one class via the cascade above. */
export function resolveOne(name: string, sig: Signature, client: ClientRegistry): ResolveResult {
    if (sig.chunk) {
        // tier 1 — chunk-name anchor (dominant class in the named chunk)
        const inChunk = classesInChunk(sig.chunk, client);
        if (inChunk.length) {
            const best = inChunk.sort((a, b) => classMembers(b.cls).size - classMembers(a.cls).size)[0];
            return { name, cls: best.cls, via: 'chunk', key: best.key };
        }
        // tier 2 — import-graph walk: fuzzy-pick among the entry's boot-imported chunks
        if (sig.members) {
            const graph = fuzzyPick(name, sig, classesViaImportGraph(client));
            if (graph.cls) return { ...graph, via: 'import-graph' };
        }
        // (anchor class not captured yet → caller retries on the next chunk-growth tick)
        if (!sig.members) return { name, cls: null, via: 'none' };
    }
    // tier 3 — all-classes fuzzy (adapt the registry's [key,cls] tuples to {key,cls})
    function* allCandidates(): Iterable<Candidate> {
        for (const [key, cls] of client) yield { key, cls };
    }
    return fuzzyPick(name, sig, allCandidates());
}

/** Resolve a whole table; returns only the ones that resolved this pass. */
export function resolveAll(
    signatures: Record<string, Signature>,
    client: ClientRegistry,
    already: Set<string>
): ResolveResult[] {
    const out: ResolveResult[] = [];
    for (const [name, sig] of Object.entries(signatures)) {
        if (already.has(name)) continue;
        const r = resolveOne(name, sig, client);
        if (r.cls) out.push(r);
    }
    return out;
}
