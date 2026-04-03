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
  wasGuaranteed: boolean;
  extra?: Record<string, unknown>;
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
   * Annotates each pull with pity counters.
   * Receives all pulls for a given user + game + banner type in chronological
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
// API response shapes (used by both Eden Treaty client and server handlers)
// ---------------------------------------------------------------------------

export interface Game {
  id: string;
  displayName: string;
  iconUrl: string | null;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: number;
}

export interface UserGame {
  id: string;
  userId: string;
  gameId: string;
  lastImport: number | null;
  latestPullIds: Record<string, string> | null;
  createdAt: number;
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
  pulledAt: number;
  pityAtPull: number;
  wasGuaranteed: boolean;
  pityVersion: number;
  extra: Record<string, unknown> | null;
  createdAt: number;
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
  extra?: Record<string, unknown>;
}

export interface ImportResult {
  importId: string;
  newPulls: number;
  duplicates: number;
  errors: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}
