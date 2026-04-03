// ============================================================================
// Constants: banner types and rarity tiers per game
// ============================================================================

// ---------------------------------------------------------------------------
// Honkai: Star Rail
// ---------------------------------------------------------------------------

export const HSR_BANNER_TYPES = [
  ["Stellar Warp", 1],
  ["Departure Warp", 2],
  ["Character Event Warp", 11],
  ["Light Cone Event Warp", 12],
] as const;

export type HsrBannerType = (typeof HSR_BANNER_TYPES)[number];

export const HSR_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Genshin Impact
// ---------------------------------------------------------------------------

export const GENSHIN_BANNER_TYPES = [
  ["Novice Wishes", 100],
  ["Wanderlust Invocation", 200],
  ["Character Event Wish", 301],
  ["Epitome Invocation", 302],
  ["Character Event Wish - 2", 400],
  ["Chronicled Wish", 500],
] as const;

export type GenshinBannerType = (typeof GENSHIN_BANNER_TYPES)[number];

export const GENSHIN_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Zenless Zone Zero
// ---------------------------------------------------------------------------

export const ZZZ_BANNER_TYPES = [
  ["Standard Channel", 1],
  ["Exclusive Channel", 2],
  ["W-Engine Channel", 3],
  ["Bangboo Channel", 5],
] as const;

export type ZzzBannerType = (typeof ZZZ_BANNER_TYPES)[number];

export const ZZZ_RARITY_TIERS = [2, 3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Wuthering Waves
// ---------------------------------------------------------------------------

export const WUWA_BANNER_TYPES = [
  ["Featured Resonator Convene", 1],
  ["Featured Weapon Convene", 2],
  ["Standard Resonator Convene", 3],
  ["Standard Weapon Convene", 4],
  ["Novice Convene", 5],
  ["Beginner's Choice Convene", 6],
] as const;

export type WuwaBannerType = (typeof WUWA_BANNER_TYPES)[number];

export const WUWA_RARITY_TIERS = [3, 4, 5] as const;

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

export const BANNER_TYPES = {
  starrail: HSR_BANNER_TYPES,
  genshin: GENSHIN_BANNER_TYPES,
  zzz: ZZZ_BANNER_TYPES,
  wuwa: WUWA_BANNER_TYPES,
} as const;

export const RARITY_TIERS = {
  starrail: HSR_RARITY_TIERS,
  genshin: GENSHIN_RARITY_TIERS,
  zzz: ZZZ_RARITY_TIERS,
  wuwa: WUWA_RARITY_TIERS,
} as const;

export type GameId = keyof typeof BANNER_TYPES;
