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
  [HSR_BANNERS.STANDARD]: "Stellar Warp",
  [HSR_BANNERS.BEGINNER]: "Departure Warp",
  [HSR_BANNERS.CHARACTER]: "Character Event Warp",
  [HSR_BANNERS.WEAPON]: "Light Cone Event Warp",
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
} as const;

export const ZZZ_BANNER_NAMES: Record<number, string> = {
  [ZZZ_BANNERS.STANDARD]: "Standard Channel",
  [ZZZ_BANNERS.CHARACTER]: "Exclusive Channel",
  [ZZZ_BANNERS.WEAPON]: "W-Engine Channel",
  [ZZZ_BANNERS.BANGBOO]: "Bangboo Channel",
};

export const ZZZ_RARITY_TIERS = [2, 3, 4, 5] as const;

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
} as const;

export const WUWA_BANNER_NAMES: Record<number, string> = {
  [WUWA_BANNERS.CHARACTER]: "Featured Resonator Convene",
  [WUWA_BANNERS.WEAPON]: "Featured Weapon Convene",
  [WUWA_BANNERS.STANDARD_CHARACTER]: "Standard Resonator Convene",
  [WUWA_BANNERS.STANDARD_WEAPON]: "Standard Weapon Convene",
  [WUWA_BANNERS.BEGINNER]: "Novice Convene",
  [WUWA_BANNERS.BEGINNER_CHOICE]: "Beginner's Choice Convene",
};

export const WUWA_RARITY_TIERS = [3, 4, 5] as const;

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
