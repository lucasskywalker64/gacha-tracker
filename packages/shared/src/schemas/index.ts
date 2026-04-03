import { z } from "zod";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Cursor-based pagination query params for pull history.
 * Cursor is encoded as "<pulled_at>_<pull_id>".
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  bannerType: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

// ---------------------------------------------------------------------------
// Individual pull (received from extraction script)
// ---------------------------------------------------------------------------

export const rawPullSchema = z.object({
  pullId: z.string().min(1),
  bannerType: z.string().min(1),
  bannerId: z.string().optional(),
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  itemType: z.string().min(1),
  rarity: z.number().int().min(1).max(6),
  pulledAt: z.string().min(1), // ISO-8601 or game timestamp — normalised by adapter
  // Zod v4: z.record() requires (keyType, valueType)
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type RawPull = z.infer<typeof rawPullSchema>;

// ---------------------------------------------------------------------------
// Import payload (posted by extraction script to POST /pulls/import)
// ---------------------------------------------------------------------------

export const importPayloadSchema = z.object({
  gameId: z.string().min(1),
  gameUid: z.string().min(1),
  pulls: z
    .array(rawPullSchema)
    .min(1, "Import payload must contain at least one pull"),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;

// ---------------------------------------------------------------------------
// Normalised pull (returned by game adapters; stored in DB)
// ---------------------------------------------------------------------------

export const normalizedPullSchema = z.object({
  pullId: z.string().min(1),
  gameUid: z.string().min(1),
  bannerType: z.string().min(1),
  bannerId: z.string().optional(),
  itemId: z.string().min(1),
  itemName: z.string().min(1),
  itemType: z.string().min(1),
  rarity: z.number().int().min(1).max(6),
  pulledAt: z.date(),
  pityAtPull: z.number().int().min(0),
  wasGuaranteed: z.boolean(),
  // Zod v4: z.record() requires (keyType, valueType)
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type NormalizedPullSchema = z.infer<typeof normalizedPullSchema>;
