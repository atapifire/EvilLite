/*! EvilLite Reflector — resolver (Layer 2)
 *
 * Turns the captured registry of minified game classes into named hooks, in a way
 * that survives EvilQuest bundle updates. No AST parsing: we inspect the LIVE classes
 * that the capture layer registered into `document.client` (name -> Class), plus the
 * index-aligned chunk URLs in `window.__eqSourceUrls` / `window.__eqSourceModules`.
 *
 * Two rename-proof techniques:
 *   - `chunk`: a structural anchor — match a class by the chunk filename it ships in
 *     (e.g. GameManager is in `GameManager-<hash>.js`; the [name] is stable, the hash
 *     rotates). Best for the entry point, which everything else hangs off.
 *   - `members` + `threshold`: fuzzy N-of-M match on prototype members. A class matches
 *     if ≥ threshold of its signature members are present AND it's the unique best match.
 *     Survives a method rename or two; refuses to bind on a tie (loud, never silent).
 */

export interface Signature {
    /** Distinctive prototype members (methods + getters) that identify the class. */
    members?: string[];
    /** Fraction of `members` that must be present to count as a match. Default 0.6. */
    threshold?: number;
    /** Structural anchor: identify the class by the chunk filename it ships in. */
    chunk?: RegExp;
}

export interface ResolveResult {
    name: string;
    cls: any | null;
    /** 'chunk' | 'fuzzy' | 'none' | 'ambiguous' — for diagnostics. */
    via: string;
    /** The minified key it resolved to (changes every build; diagnostics only). */
    key?: string;
}

type ClientRegistry = Map<string, any>;

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

/**
 * Live classes declared in any captured chunk whose URL matches `re`.
 * Reads the class names out of the chunk source and looks them up in the registry,
 * so we only return classes that actually exist at runtime.
 */
export function classesInChunk(re: RegExp, client: ClientRegistry): { key: string; cls: any }[] {
    const w = globalThis as any;
    const urls: string[] = w.__eqSourceUrls ?? [];
    const mods: string[] = w.__eqSourceModules ?? [];
    const out: { key: string; cls: any }[] = [];
    for (let i = 0; i < urls.length; i++) {
        if (!re.test(urls[i])) continue;
        for (const m of (mods[i] ?? '').matchAll(/\bclass\s+([A-Za-z0-9_$]+)/g)) {
            const cls = client.get(m[1]);
            if (cls) out.push({ key: m[1], cls });
        }
    }
    return out;
}

/** Resolve one signature to exactly one class. Logs (and returns null) on no-match/ambiguity. */
export function resolveOne(name: string, sig: Signature, client: ClientRegistry): ResolveResult {
    // 1. structural anchor first — most rename-proof, and the chunk may carry one dominant class.
    if (sig.chunk) {
        const inChunk = classesInChunk(sig.chunk, client);
        if (inChunk.length) {
            // pick the dominant class in the chunk (the entry point is the biggest one)
            const best = inChunk.sort((a, b) => classMembers(b.cls).size - classMembers(a.cls).size)[0];
            return { name, cls: best.cls, via: 'chunk', key: best.key };
        }
        // anchor chunk not captured yet (loads late) — caller retries on next growth tick.
        if (!sig.members) return { name, cls: null, via: 'none' };
    }

    // 2. fuzzy N-of-M over the live registry.
    const members = sig.members ?? [];
    if (!members.length) return { name, cls: null, via: 'none' };
    const need = Math.ceil((sig.threshold ?? 0.6) * members.length);

    const scored: { key: string; cls: any; score: number }[] = [];
    for (const [key, cls] of client) {
        const have = classMembers(cls);
        if (!have.size) continue;
        let score = 0;
        for (const m of members) if (have.has(m)) score++;
        if (score >= need) scored.push({ key, cls, score });
    }
    if (!scored.length) return { name, cls: null, via: 'none' };
    scored.sort((a, b) => b.score - a.score);

    // unique best? (a tie at the top means the signature isn't distinctive enough — fail loud)
    if (scored.length > 1 && scored[0].score === scored[1].score) {
        // eslint-disable-next-line no-console
        console.error(`[Reflector] AMBIGUOUS ${name} -> ${scored.slice(0, 3).map(s => s.key).join(', ')} (tighten its signature)`);
        return { name, cls: null, via: 'ambiguous' };
    }
    return { name, cls: scored[0].cls, via: 'fuzzy', key: scored[0].key };
}

/** Resolve a whole signature table. Returns only the ones that resolved this pass. */
export function resolveAll(
    signatures: Record<string, Signature>,
    client: ClientRegistry,
    already: Set<string>
): ResolveResult[] {
    const out: ResolveResult[] = [];
    for (const [name, sig] of Object.entries(signatures)) {
        if (already.has(name)) continue;           // already bound — don't redo
        const r = resolveOne(name, sig, client);
        if (r.cls) out.push(r);
    }
    return out;
}
