/*! EvilLite Reflector — signature table (Layer 2 data)
 *
 * One entry per game class we want a stable handle to. Resolved by ./resolver.ts.
 * Verified live against the 2026-06-21 EvilQuest bundle; see CamelC0re/Client#28.
 *
 * Format:
 *   chunk     — structural anchor: the chunk filename the class ships in. Most rename-proof;
 *               use for the entry point. [name] is stable across builds, only the hash rotates.
 *   members   — distinctive prototype members for fuzzy N-of-M matching.
 *   threshold — fraction of members that must match (default 0.6 → survives ~1 rename).
 *
 * NOTE on EQ's 2026 refactor: most former "managers" were COLLAPSED into GameManager
 * (a 600+ member god-class) or EntityManager. Those are not separate classes anymore —
 * they're documented at the bottom so consumers call them as GameManager/EntityManager
 * methods instead of hunting for a class that no longer exists.
 */

import type { Signature } from './resolver';

export const CLASS_SIGNATURES: Record<string, Signature> = {
    // Entry point — anchored structurally by chunk, with a fuzzy fallback.
    GameManager: {
        chunk: /\/GameManager-[\w]+\.js(\?|$)/,
        members: ['updateMinimap', 'worldObjectDisplayName', 'waitForCurrentLocalPlayerReady', 'setupContextMenu'],
    },
    EntityManager: { members: ['createRemotePlayer', 'createNpc', 'findNearestNpc', 'createGroundItem'] },
    SocketManager: { members: ['openSockets', 'sendFrame', 'handleOpcodeMapping', 'consumePendingInputTicket'] },
    ChunkManager: { members: ['getMapId', 'getMapWidth', 'ensureFloorLayer', 'getTerrainDetailStats'] },
    InputManager: { members: ['handlePrimaryActionAt', 'pickGround', 'setObjectClickHandler', 'setGroundClickHandler'] },
    BankUIManager: { members: ['openWithContents', 'updateBankSlot', 'sendWithdrawMode', 'makeWithdrawModeToggle'] },
    ChatManager: { members: ['appendMessage', 'addPrivateMessage', 'installChatStyles', 'isScrolledToChatBottom'] },
    GameCameraManager: { members: ['setLockedMode', 'applyLockState', 'setLockedRadiusScale', 'lockedPitchRadiusRatio'] },
    MeshManager: { members: ['loadAll', 'loadModelTemplate', 'getStump', 'cloneActiveMaterial'] },
    // UI panels (each its own class):
    DialoguePanel: { members: ['closeSession', 'cancelDialogue', 'advance', 'optionIndexFromKey'] },
    SmithingPanel: { members: ['renderBarPicker', 'maxQuantityForRecipe', 'renderRecipesForBar'] },
    TradePanel: { members: ['showIncomingRequest', 'updateOffer', 'updateAcceptState'] },
    DuelPanel: { members: ['updateStake', 'removeStakeSlot', 'openSession'] },
    SidePanel: { members: ['setQuestDefs', 'setQuestState', 'setRenown', 'setToolsControls'] },
};

/** Enums, matched by ./resolver enum support (object whose values include these strings). */
export const ENUM_SIGNATURES: Record<string, { includes: string[] }> = {
    InventoryActions: { includes: ['use', 'inspect', 'drop'] },
    EntityTypes: { includes: ['Environment', 'Item'] },
    GameInterfaces: { includes: ['Inventory', 'Bank', 'Shop'] },
    Skills: { includes: ['hitpoints', 'defence', 'strength'] }, // was ['hitpoints','accuracy']; accuracy renamed
    // TODO (verify members against the live bundle, partially renamed): GameWorldActions,
    // SpellTypes, GameObjects, PlayerActions, AppearanceTypes, UISettings, RequirementTypes.
};

/**
 * Former classes that EQ merged away — do NOT add fuzzy signatures for these; they don't
 * exist as classes. Consumers should reach the functionality on the new owner instead.
 */
export const MERGED: Record<string, string> = {
    SpellManager: 'GameManager (handleSpellCastBroadcast, handleAutocastChange, isSpellMovementLocked, …)',
    SpellMenuManager: 'GameManager (same spell-cast surface)',
    MagicSkillManager: 'GameManager',
    GameLoop: 'GameManager (resetFramePaceScheduler, shouldRenderSceneFrame, updateFramePaceEstimate, …)',
    RangeManager: 'GameManager (getRangedProjectileReleaseMs, getProjectileLaunchPreview, …)',
    NameplateManager: 'GameManager (refreshNameplates, applyNpcNameplate, combatLevelDifferenceColor, …)',
    ContextMenuManager: 'GameManager (setupContextMenu, openWorldContextMenuAt, showContextMenu, …)',
    ItemDefinitionManager: 'EntityManager.itemDefsCache',
    NpcDefinitionManager: 'EntityManager.npcDefsCache',
    QuestDefinitionManager: 'GameManager.questDefsCache',
    GroundItemManager: 'EntityManager (groundItems, groundItemSprites, …)',
};
