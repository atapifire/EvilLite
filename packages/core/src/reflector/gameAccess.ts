/*! EvilLite Reflector — plugin routes (Layer 3 facade)
 *
 * The ONE place plugins reach the game. Everything is a getter, so it always returns the
 * current live instance (or null before it's bound) — plugins never cache a stale handle
 * and never touch document.highlite.gameHooks directly.
 *
 * Crucially this also hides EQ's class consolidation: e.g. `game.minimap` and
 * `game.localPlayer` live on GameManager now, `game.itemDefs` moved onto EntityManager.
 * When EQ reshuffles again, we fix the route HERE and every plugin keeps working unchanged.
 */

function instanceOf(name: string): any | null {
    return (document as any).highlite?.gameHooks?.[name]?.Instance ?? null;
}

export const game = {
    // ── core managers (each a real, signature-hooked class) ──────────────────
    get manager() { return instanceOf('GameManager'); },
    get entities() { return instanceOf('EntityManager'); },
    get socket() { return instanceOf('SocketManager'); },
    get chunks() { return instanceOf('ChunkManager'); },
    get input() { return instanceOf('InputManager'); },
    get camera() { return instanceOf('GameCameraManager'); },
    get meshes() { return instanceOf('MeshManager'); },
    get chat() { return instanceOf('ChatManager'); },

    // ── UI panels ────────────────────────────────────────────────────────────
    get bank() { return instanceOf('BankUIManager'); },
    get dialogue() { return instanceOf('DialoguePanel'); },
    get trade() { return instanceOf('TradePanel'); },
    get duel() { return instanceOf('DuelPanel'); },
    get smithing() { return instanceOf('SmithingPanel'); },
    get sidePanel() { return instanceOf('SidePanel'); },

    // ── semantic shortcuts (absorb EQ's "everything moved onto GameManager") ──
    get minimap() { return instanceOf('GameManager')?.minimap ?? null; },
    get localPlayer() { return instanceOf('GameManager')?.localPlayer ?? null; },
    get scene() { return instanceOf('GameManager')?.scene ?? null; },
    get engine() { return instanceOf('GameManager')?.engine ?? null; },
    get network() { return instanceOf('GameManager')?.network ?? instanceOf('SocketManager'); },

    // ── definition caches (def managers merged into EntityManager / GameManager) ──
    get itemDefs() { return instanceOf('EntityManager')?.itemDefsCache ?? null; },
    get npcDefs() { return instanceOf('EntityManager')?.npcDefsCache ?? null; },
    get questDefs() { return instanceOf('GameManager')?.questDefsCache ?? null; },
    get objectDefs() { return instanceOf('GameManager')?.objectDefsCache ?? null; },

    // ── convenience ──────────────────────────────────────────────────────────
    /** The logged-in username, or null if not in-world yet. */
    get username() { return instanceOf('GameManager')?.username ?? null; },
    /** True once the game is live and the entry point is bound. */
    get ready() { return !!instanceOf('GameManager'); },
    /** Escape hatch: raw access to a hooked class instance by name. */
    raw(name: string) { return instanceOf(name); },
};

export type Game = typeof game;
