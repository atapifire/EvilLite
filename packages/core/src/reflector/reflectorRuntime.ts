/*! EvilLite Reflector — runtime orchestrator (Layer 3)
 *
 * Ties the capture layer (document.client + __eqSourceModules/__eqSourceUrls) to the
 * resolver (Layer 2) and exposes named hooks at document.highlite.gameHooks.
 *
 * Convention (matches the existing HookManager): document.highlite.gameHooks[Name] is the
 * CLASS; gameHooks[Name].Instance is the live instance, captured the first time one of the
 * class's signature methods runs (game-side classes aren't singletons we can grab directly).
 *
 * Trigger: call reflectorTick() on a steady poll AND from onEqModuleLoaded. It no-ops unless
 * the captured-chunk count grew, and only ever binds classes it hasn't bound yet. Because EQ
 * code-splits and GameManager's chunk loads LATE (on world-entry), this re-runs until the
 * late chunks arrive — never gated on a game global (EQ removed window.gm and bricked us).
 */

import { resolveAll, type Signature } from './resolver';
import { CLASS_SIGNATURES } from './signatures.runtime';

const bound = new Set<string>();
let lastModuleCount = -1;

function ensureHooks(): Record<string, any> {
    const d = document as any;
    d.highlite = d.highlite ?? {};
    d.highlite.gameHooks = d.highlite.gameHooks ?? {};
    return d.highlite.gameHooks;
}

/** Wrap one signature method so the live instance lands in cls.Instance on first call. */
function captureInstanceOn(cls: any, sig: Signature): void {
    const proto = cls?.prototype;
    if (!proto) return;
    const member = (sig.members ?? []).find((m) => typeof proto[m] === 'function');
    if (!member) return; // getter-only signature → nothing safe to wrap; Instance set elsewhere
    const original = proto[member];
    proto[member] = function (this: any, ...args: any[]) {
        if (cls.Instance === undefined) {
            try { cls.Instance = this; } catch { /* getter-only Instance — leave it */ }
        }
        return original.apply(this, args);
    };
}

/**
 * One resolve+bind pass. Returns the names bound THIS pass (for logging/tests).
 * Idempotent and cheap; safe to call frequently.
 */
export function reflectorTick(): string[] {
    const client = (document as any).client as Map<string, any> | undefined;
    if (!client) return [];

    const w = globalThis as any;
    const count: number = w.__eqSourceModules?.length ?? 0;
    if (count === lastModuleCount) return []; // nothing new captured since last pass
    lastModuleCount = count;

    const hooks = ensureHooks();
    const newly: string[] = [];
    for (const r of resolveAll(CLASS_SIGNATURES, client, bound)) {
        // Cooperative + idempotent: if another binder (e.g. the legacy reflector) already
        // bound this name, adopt it and move on — don't double-wrap its methods.
        if (hooks[r.name]) { bound.add(r.name); continue; }
        hooks[r.name] = r.cls;
        captureInstanceOn(r.cls, CLASS_SIGNATURES[r.name]);
        bound.add(r.name);
        newly.push(`${r.name}<-${r.key ?? '?'}(${r.via})`);
    }
    if (newly.length) {
        // eslint-disable-next-line no-console
        console.log('[Reflector] bound', bound.size, 'classes:', newly.join(', '));
    }
    return newly;
}

/** Have all signature classes been bound? (entry point + leaves). */
export function reflectorComplete(): boolean {
    return bound.size >= Object.keys(CLASS_SIGNATURES).length;
}

/** True once the entry point is available (gates plugin start). */
export function gameManagerReady(): boolean {
    return !!(document as any).highlite?.gameHooks?.GameManager?.Instance;
}

/** Clear state (e.g. on a full reload / bundle swap). */
export function reflectorReset(): void {
    bound.clear();
    lastModuleCount = -1;
}
