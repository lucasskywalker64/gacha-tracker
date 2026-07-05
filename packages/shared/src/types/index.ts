// ============================================================================
// Core domain types shared between apps/api and apps/web
// ============================================================================

// ---------------------------------------------------------------------------
// Pity
// ---------------------------------------------------------------------------

export interface PityConfig {
    /** All rarity tiers the game uses, e.g. [3, 4, 5] for HoYoverse games. */
    rarityTiers: number[];
    /** The rarity whose pull resets the pity counter, e.g. 5 for HoYoverse. */
    pityTriggerRarity: number;
    /**
     * Pull number at which soft pity begins per banner type.
     * e.g. { character: 74, weapon: 64, standard: 74 }
     */
    softPity: Record<string, number>;
    /**
     * Guaranteed hard-pity pull number per banner type.
     * e.g. { character: 90, weapon: 80, standard: 90 }
     */
    hardPity: Record<string, number>;
    /**
     * Whether a lost 50/50 on one pull guarantees the next pity-trigger-rarity
     * pull on the same banner type.
     */
    guaranteeAfterFailed: boolean;
    /**
     * Explicit order for displaying banners in the UI.
     * Uses stringified banner IDs.
     */
    bannerOrder: string[];
}

// ---------------------------------------------------------------------------
// Game adapter interface
// ---------------------------------------------------------------------------

export interface NormalizedPull {
    pullId: string;
    gameUid: string;
    bannerType: string;
    bannerId?: string;
    itemId: string;
    itemName: string;
    itemType: string;
    rarity: number;
    pulledAt: Date;
    pityAtPull: number;
    wasGuaranteed: number;
}

export interface NormalizedImportResult {
    pulls: NormalizedPull[];
    gameUid: string;
}

export interface GameAdapter {
    gameId: string;
    displayName: string;
    bannerTypes: string[];
    pityConfig: PityConfig;

    /**
     * Validates and normalises a raw import payload into canonical pulls.
     * Must throw a typed error for invalid payloads so the import handler can
     * return a structured 422 response.
     */
    normalizeImport(raw: unknown): Promise<NormalizedImportResult>;

    /**
     * Map of banner type IDs to their shared pity pool.
     * If omitted, each banner type tracks its own pity independently.
     * e.g. For Genshin: { "301": "limited_character", "400": "limited_character" }
     */
    pityPools?: Record<string, string>;

    /**
     * Annotates each pull with pity counters.
     * Receives all pulls for a given user + game + pity pool in chronological
     * order (oldest first), including any pulls already stored in the DB.
     * Returns the same array with pityAtPull and wasGuaranteed set.
     */
    computePity(pulls: NormalizedPull[], bannerType: string): NormalizedPull[];
}

// ---------------------------------------------------------------------------
// Tracker adapter interface (Phase 2 — third-party CSV/Excel imports)
// ---------------------------------------------------------------------------

export interface TrackerAdapter {
    trackerId: string;
    displayName: string;
    targetGameId: string;
    expectedMimeTypes: string[];

    /** Parses a binary file buffer into standard normalized pulls. */
    parse(fileBuffer: ArrayBuffer, mimeType: string): Promise<NormalizedPull[]>;
}

// ---------------------------------------------------------------------------
// Export / Backup Types
// ---------------------------------------------------------------------------

export interface ExportPullData {
    pullId: string;
    bannerType: string;
    bannerId?: string | null;
    itemId: string;
    itemName: string;
    itemType: string;
    rarity: number;
    pulledAt: string;
    pityAtPull: number;
    wasGuaranteed: number;
}

export interface ExportGameData {
    gameId: string;
    gameUid: string;
    pulls: ExportPullData[];
}

export interface NativeExportData {
    version: number;
    exportedAt: string;
    games: ExportGameData[];
}

// ---------------------------------------------------------------------------
// API response shapes (used by both Eden Treaty client and server handlers)
// ---------------------------------------------------------------------------

export interface Game {
    id: string;
    displayName: string;
    iconUrl: string | null;
    isActive: boolean;
    config: Record<string, unknown>;
    createdAt: Date;
}

export interface UserGame {
    id: string;
    userId: string;
    gameId: string;
    lastImport: Date | null;
    latestPullIds: Record<string, string> | null;
    createdAt: Date;
}

export interface Pull {
    id: string;
    userId: string;
    gameId: string;
    gameUid: string;
    pullId: string;
    bannerType: string;
    bannerId: string | null;
    itemId: string;
    itemName: string;
    itemType: string;
    rarity: number;
    pulledAt: Date;
    pityAtPull: number;
    wasGuaranteed: number;
    pityVersion: number;
    createdAt: Date;
}

export interface GameStats {
    total: number;
    fiveStars: number;
    fourStars: number;
    currentPity: Record<string, number>;
    fiveStarHistory: {
        id: string;
        itemId: string;
        itemName: string;
        pityAtPull: number;
        wasGuaranteed: number;
        pulledAt: number;
        bannerType: string;
        bannerId?: string | null;
    }[];
}

export interface ImportPayload {
    gameId: string;
    gameUid: string;
    pulls: RawPull[];
}

export interface RawPull {
    pullId: string;
    bannerType: string;
    bannerId?: string;
    itemId: string;
    itemName: string;
    itemType: string;
    rarity: number;
    pulledAt: string;
}

export interface ImportResult {
    importId: string;
    newPulls: number;
    duplicates: number;
    errors: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    meta: {
        page: number;
        limit: number;
        hasNextPage: boolean;
        total: number;
    };
}

/**
 * Display properties for a single rarity tier within a game.
 * Fully describes how to render a pull of that rarity — no hardcoding
 * of specific values like 3, 4, or 5 anywhere in components.
 */
export interface RarityDisplayConfig {
    /** The numeric rarity value as stored in the DB (e.g. 5, 4, 3, or 6 for future games). */
    value: number;
    /** Human-readable label shown in UI (e.g. "5★", "Gold", "Legendary"). */
    label: string;
    /**
     * Tailwind CSS color token for text (e.g. "text-yellow-400").
     * Using a string token (not a full class) so Tailwind's JIT scanner can
     * detect it — always use full class strings, not dynamic concatenation.
     */
    textColor: string;
    /** Background accent class for badges/rows (e.g. "bg-yellow-400/10"). */
    bgColor: string;
    /** Border accent class (e.g. "border-yellow-400/30"). */
    borderColor: string;
    /** Whether this rarity tier is the one that triggers pity reset. */
    triggersPity: boolean;
    /** Display sort order — higher = rendered more prominently (e.g. 5★ first). */
    sortOrder: number;
}

/** Wizard-specific configurations for automated imports. */
export interface WizardConfig {
    /** The name of the game's pull history menu (e.g. "Warp", "Wish", "Convene"). */
    historyName: string;
    /** The name of the records/history button (e.g. "Records", "History"). */
    recordsName: string;
    /** Relative path to the extraction script from the repository root. */
    scriptPath: string;
}

/** Full game-level config used by both the API adapter and the frontend. */
export interface GameConfig {
    gameId: string;
    displayName: string;
    pityConfig: PityConfig;
    /** Ordered list of rarity tiers, from lowest to highest. */
    rarityDisplay: RarityDisplayConfig[];
    /** Wizard-specific configurations. Optional if the game does not support automated imports yet. */
    wizard?: WizardConfig;
}
