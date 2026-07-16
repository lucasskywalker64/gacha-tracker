// ============================================================================
// Constants: banner types and rarity tiers per game
// ============================================================================

// ---------------------------------------------------------------------------
// Honkai: Star Rail
// ---------------------------------------------------------------------------

export const HSR_BANNERS = {
    STANDARD: 1,
    BEGINNER: 2,
    CHARACTER: 11,
    WEAPON: 12,
} as const;

export const HSR_BANNER_NAMES: Record<number, string> = {
    [HSR_BANNERS.CHARACTER]: "Character Event Warp",
    [HSR_BANNERS.WEAPON]: "Light Cone Event Warp",
    [HSR_BANNERS.STANDARD]: "Stellar Warp",
    [HSR_BANNERS.BEGINNER]: "Departure Warp",
};

export const HSR_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Genshin Impact
// ---------------------------------------------------------------------------

export const GENSHIN_BANNERS = {
    NOVICE: 100,
    STANDARD: 200,
    CHARACTER: 301,
    WEAPON: 302,
    CHARACTER_2: 400,
    CHRONICLED: 500,
} as const;

export const GENSHIN_BANNER_NAMES: Record<number, string> = {
    [GENSHIN_BANNERS.NOVICE]: "Novice Wishes",
    [GENSHIN_BANNERS.STANDARD]: "Wanderlust Invocation",
    [GENSHIN_BANNERS.CHARACTER]: "Character Event Wish",
    [GENSHIN_BANNERS.WEAPON]: "Epitome Invocation",
    [GENSHIN_BANNERS.CHARACTER_2]: "Character Event Wish - 2",
    [GENSHIN_BANNERS.CHRONICLED]: "Chronicled Wish",
};

export const GENSHIN_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Zenless Zone Zero
// ---------------------------------------------------------------------------

export const ZZZ_BANNERS = {
    STANDARD: 1,
    CHARACTER: 2,
    WEAPON: 3,
    BANGBOO: 5,
    RESCREENING_CHARACTER: 5001,
    RESCREENING_WEAPON: 13001,
} as const;

export const ZZZ_BANNER_NAMES: Record<number, string> = {
    [ZZZ_BANNERS.STANDARD]: "Standard Channel",
    [ZZZ_BANNERS.CHARACTER]: "Exclusive Channel",
    [ZZZ_BANNERS.WEAPON]: "W-Engine Channel",
    [ZZZ_BANNERS.BANGBOO]: "Bangboo Channel",
    [ZZZ_BANNERS.RESCREENING_CHARACTER]: "Exclusive Rescreening",
    [ZZZ_BANNERS.RESCREENING_WEAPON]: "W-Engine Rescreening",
};

export const ZZZ_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Wuthering Waves
// ---------------------------------------------------------------------------

export const WUWA_BANNERS = {
    CHARACTER: 1,
    WEAPON: 2,
    STANDARD_CHARACTER: 3,
    STANDARD_WEAPON: 4,
    BEGINNER: 5,
    BEGINNER_CHOICE: 6,
    COLLAB_CHARACTER: 10,
    COLLAB_WEAPON: 11,
    REVERB_CHARACTER: 12,
    REVERB_WEAPON: 13,
} as const;

export const WUWA_BANNER_NAMES: Record<number, string> = {
    [WUWA_BANNERS.CHARACTER]: "Featured Resonator Convene",
    [WUWA_BANNERS.WEAPON]: "Featured Weapon Convene",
    [WUWA_BANNERS.STANDARD_CHARACTER]: "Standard Resonator Convene",
    [WUWA_BANNERS.STANDARD_WEAPON]: "Standard Weapon Convene",
    [WUWA_BANNERS.BEGINNER]: "Novice Convene",
    [WUWA_BANNERS.BEGINNER_CHOICE]: "Beginner's Choice Convene",
    [WUWA_BANNERS.COLLAB_CHARACTER]: "Collab Resonator Convene",
    [WUWA_BANNERS.COLLAB_WEAPON]: "Collab Weapon Convene",
    [WUWA_BANNERS.REVERB_CHARACTER]: "Reverb Resonator Convene",
    [WUWA_BANNERS.REVERB_WEAPON]: "Reverb Weapon Convene",
};

export const WUWA_RARITY_TIERS = [3, 4, 5] as const;

export const WUWA_STANDARD_CHARACTERS = ["1503", "1203", "1301", "1104", "1405"];

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

export const BANNER_NAMES = {
    starrail: HSR_BANNER_NAMES,
    genshin: GENSHIN_BANNER_NAMES,
    zzz: ZZZ_BANNER_NAMES,
    wuwa: WUWA_BANNER_NAMES,
} as const;

export const RARITY_TIERS = {
    starrail: HSR_RARITY_TIERS,
    genshin: GENSHIN_RARITY_TIERS,
    zzz: ZZZ_RARITY_TIERS,
    wuwa: WUWA_RARITY_TIERS,
} as const;

export type GameId = keyof typeof BANNER_NAMES;

import type { GameConfig } from "../types";

// ---------------------------------------------------------------------------
// Game Configurations (Single Source of Truth)
// ---------------------------------------------------------------------------

export const GAME_CONFIGS: Record<string, GameConfig> = {
    starrail: {
        gameId: "starrail",
        displayName: "Honkai: Star Rail",
        pityConfig: {
            rarityTiers: [3, 4, 5],
            pityTriggerRarity: 5,
            softPity: {
                [HSR_BANNERS.STANDARD]: 74,
                [HSR_BANNERS.BEGINNER]: 40,
                [HSR_BANNERS.CHARACTER]: 74,
                [HSR_BANNERS.WEAPON]: 64,
            },
            hardPity: {
                [HSR_BANNERS.STANDARD]: 90,
                [HSR_BANNERS.BEGINNER]: 50,
                [HSR_BANNERS.CHARACTER]: 90,
                [HSR_BANNERS.WEAPON]: 80,
            },
            guaranteeAfterFailed: true,
            bannerOrder: [
                String(HSR_BANNERS.CHARACTER),
                String(HSR_BANNERS.WEAPON),
                String(HSR_BANNERS.STANDARD),
                String(HSR_BANNERS.BEGINNER),
            ],
        },
        wizard: {
            historyName: "Warp",
            recordsName: "Records",
            scriptPath: "packages/game-scripts/hsr/extract.ps1",
        },
        rarityDisplay: [
            {
                value: 5,
                label: "5★",
                textColor: "text-yellow-400",
                bgColor: "bg-yellow-400/10",
                borderColor: "border-yellow-400/30",
                triggersPity: true,
                sortOrder: 3,
            },
            {
                value: 4,
                label: "4★",
                textColor: "text-violet-400",
                bgColor: "bg-violet-400/10",
                borderColor: "border-violet-400/30",
                triggersPity: false,
                sortOrder: 2,
            },
            {
                value: 3,
                label: "3★",
                textColor: "text-blue-400",
                bgColor: "bg-blue-400/10",
                borderColor: "border-blue-400/30",
                triggersPity: false,
                sortOrder: 1,
            },
        ],
    },
    genshin: {
        gameId: "genshin",
        displayName: "Genshin Impact",
        pityConfig: {
            rarityTiers: [3, 4, 5],
            pityTriggerRarity: 5,
            softPity: {
                [GENSHIN_BANNERS.STANDARD]: 74,
                [GENSHIN_BANNERS.NOVICE]: 8,
                [GENSHIN_BANNERS.CHARACTER]: 74,
                [GENSHIN_BANNERS.WEAPON]: 63,
                [GENSHIN_BANNERS.CHARACTER_2]: 74,
                [GENSHIN_BANNERS.CHRONICLED]: 74,
            },
            hardPity: {
                [GENSHIN_BANNERS.STANDARD]: 90,
                [GENSHIN_BANNERS.NOVICE]: 10,
                [GENSHIN_BANNERS.CHARACTER]: 90,
                [GENSHIN_BANNERS.WEAPON]: 80,
                [GENSHIN_BANNERS.CHARACTER_2]: 90,
                [GENSHIN_BANNERS.CHRONICLED]: 90,
            },
            guaranteeAfterFailed: true,
            bannerOrder: [
                String(GENSHIN_BANNERS.NOVICE),
                String(GENSHIN_BANNERS.STANDARD),
                String(GENSHIN_BANNERS.CHARACTER),
                String(GENSHIN_BANNERS.WEAPON),
                String(GENSHIN_BANNERS.CHARACTER_2),
                String(GENSHIN_BANNERS.CHRONICLED),
            ],
        },
        wizard: {
            historyName: "Wish",
            recordsName: "History",
            scriptPath: "packages/game-scripts/genshin/extract.ps1",
        },
        rarityDisplay: [
            {
                value: 5,
                label: "5★",
                textColor: "text-yellow-400",
                bgColor: "bg-yellow-400/10",
                borderColor: "border-yellow-400/30",
                triggersPity: true,
                sortOrder: 3,
            },
            {
                value: 4,
                label: "4★",
                textColor: "text-violet-400",
                bgColor: "bg-violet-400/10",
                borderColor: "border-violet-400/30",
                triggersPity: false,
                sortOrder: 2,
            },
            {
                value: 3,
                label: "3★",
                textColor: "text-blue-400",
                bgColor: "bg-blue-400/10",
                borderColor: "border-blue-400/30",
                triggersPity: false,
                sortOrder: 1,
            },
        ],
    },
    zzz: {
        gameId: "zzz",
        displayName: "Zenless Zone Zero",
        pityConfig: {
            rarityTiers: [3, 4, 5],
            pityTriggerRarity: 5,
            softPity: {
                [ZZZ_BANNERS.STANDARD]: 74,
                [ZZZ_BANNERS.CHARACTER]: 74,
                [ZZZ_BANNERS.WEAPON]: 64,
                [ZZZ_BANNERS.BANGBOO]: 65,
                [ZZZ_BANNERS.RESCREENING_CHARACTER]: 74,
                [ZZZ_BANNERS.RESCREENING_WEAPON]: 64,
            },
            hardPity: {
                [ZZZ_BANNERS.STANDARD]: 90,
                [ZZZ_BANNERS.CHARACTER]: 90,
                [ZZZ_BANNERS.WEAPON]: 80,
                [ZZZ_BANNERS.BANGBOO]: 80,
                [ZZZ_BANNERS.RESCREENING_CHARACTER]: 90,
                [ZZZ_BANNERS.RESCREENING_WEAPON]: 80,
            },
            guaranteeAfterFailed: true,
            bannerOrder: [
                String(ZZZ_BANNERS.STANDARD),
                String(ZZZ_BANNERS.CHARACTER),
                String(ZZZ_BANNERS.WEAPON),
                String(ZZZ_BANNERS.BANGBOO),
                String(ZZZ_BANNERS.RESCREENING_CHARACTER),
                String(ZZZ_BANNERS.RESCREENING_WEAPON),
            ],
        },
        wizard: {
            historyName: "Signal Search",
            recordsName: "Search Records",
            scriptPath: "packages/game-scripts/zzz/extract.ps1",
        },
        rarityDisplay: [
            {
                value: 5,
                label: "S",
                textColor: "text-yellow-400",
                bgColor: "bg-yellow-400/10",
                borderColor: "border-yellow-400/30",
                triggersPity: true,
                sortOrder: 3,
            },
            {
                value: 4,
                label: "A",
                textColor: "text-violet-400",
                bgColor: "bg-violet-400/10",
                borderColor: "border-violet-400/30",
                triggersPity: false,
                sortOrder: 2,
            },
            {
                value: 3,
                label: "B",
                textColor: "text-blue-400",
                bgColor: "bg-blue-400/10",
                borderColor: "border-blue-400/30",
                triggersPity: false,
                sortOrder: 1,
            },
        ],
    },
    wuwa: {
        gameId: "wuwa",
        displayName: "Wuthering Waves",
        pityConfig: {
            rarityTiers: [3, 4, 5],
            pityTriggerRarity: 5,
            softPity: {
                [WUWA_BANNERS.CHARACTER]: 64,
                [WUWA_BANNERS.WEAPON]: 64,
                [WUWA_BANNERS.STANDARD_CHARACTER]: 64,
                [WUWA_BANNERS.STANDARD_WEAPON]: 64,
                [WUWA_BANNERS.BEGINNER]: 40,
                [WUWA_BANNERS.BEGINNER_CHOICE]: 64,
                [WUWA_BANNERS.COLLAB_CHARACTER]: 64,
                [WUWA_BANNERS.COLLAB_WEAPON]: 64,
                [WUWA_BANNERS.REVERB_CHARACTER]: 64,
                [WUWA_BANNERS.REVERB_WEAPON]: 64,
            },
            hardPity: {
                [WUWA_BANNERS.CHARACTER]: 80,
                [WUWA_BANNERS.WEAPON]: 80,
                [WUWA_BANNERS.STANDARD_CHARACTER]: 80,
                [WUWA_BANNERS.STANDARD_WEAPON]: 80,
                [WUWA_BANNERS.BEGINNER]: 50,
                [WUWA_BANNERS.BEGINNER_CHOICE]: 80,
                [WUWA_BANNERS.COLLAB_CHARACTER]: 80,
                [WUWA_BANNERS.COLLAB_WEAPON]: 80,
                [WUWA_BANNERS.REVERB_CHARACTER]: 80,
                [WUWA_BANNERS.REVERB_WEAPON]: 80,
            },
            guaranteeAfterFailed: true,
            bannerOrder: [
                String(WUWA_BANNERS.CHARACTER),
                String(WUWA_BANNERS.WEAPON),
                String(WUWA_BANNERS.COLLAB_CHARACTER),
                String(WUWA_BANNERS.COLLAB_WEAPON),
                String(WUWA_BANNERS.REVERB_CHARACTER),
                String(WUWA_BANNERS.REVERB_WEAPON),
                String(WUWA_BANNERS.STANDARD_CHARACTER),
                String(WUWA_BANNERS.STANDARD_WEAPON),
                String(WUWA_BANNERS.BEGINNER),
                String(WUWA_BANNERS.BEGINNER_CHOICE),
            ],
        },
        wizard: {
            historyName: "Convene",
            recordsName: "Convene Records",
            scriptPath: "packages/game-scripts/wuwa/extract.ps1",
        },
        rarityDisplay: [
            {
                value: 5,
                label: "5★",
                textColor: "text-yellow-400",
                bgColor: "bg-yellow-400/10",
                borderColor: "border-yellow-400/30",
                triggersPity: true,
                sortOrder: 3,
            },
            {
                value: 4,
                label: "4★",
                textColor: "text-violet-400",
                bgColor: "bg-violet-400/10",
                borderColor: "border-violet-400/30",
                triggersPity: false,
                sortOrder: 2,
            },
            {
                value: 3,
                label: "3★",
                textColor: "text-blue-400",
                bgColor: "bg-blue-400/10",
                borderColor: "border-blue-400/30",
                triggersPity: false,
                sortOrder: 1,
            },
        ],
    },
};

// ---------------------------------------------------------------------------
// Script Hosting & Versioning
// ---------------------------------------------------------------------------

/** Base URL for GitHub raw content. Update if repo is ever moved. */
export const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/lucasskywalker64/gacha-tracker";

/**
 * Pinned commit SHAs for each game's extraction script.
 * Update ONLY when the corresponding script file is changed.
 * Users can verify: github.com/<org>/<repo>/commit/<sha>
 */
export const SCRIPT_VERSIONS = {
    starrail: "50d528c2d7e82951732b6ca949db654054d2a45a",
    genshin: "50d528c2d7e82951732b6ca949db654054d2a45a",
    zzz: "50d528c2d7e82951732b6ca949db654054d2a45a",
    wuwa: "63d78b387b956aaf527410140dcdd13a4bdacacc",
} as const;
