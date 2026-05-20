import { z } from "zod";
import { BANNER_NAMES } from "../constants";

// ---------------------------------------------------------------------------
// Pagination and Querying
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
    gameId: z.enum(Object.keys(BANNER_NAMES) as [string, ...string[]]),
    bannerType: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------------------------------------------------------------------------
// Import Payload definitions
// ---------------------------------------------------------------------------

export const rawPullSchema = z
    .object({
        pullId: z.string().min(1),
        bannerType: z.string().min(1),
        bannerId: z.string().optional(),
        itemId: z.string(),
        itemName: z.string().min(1),
        itemType: z.string().min(1),
        rarity: z.number().int().positive(),
        pulledAt: z.string(),
        extra: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export const importPayloadSchema = z
    .object({
        gameId: z.enum(Object.keys(BANNER_NAMES) as [string, ...string[]]),
        gameUid: z.string().min(1),
        pulls: z.array(rawPullSchema),
    })
    .strict();

export type RawPullInput = z.infer<typeof rawPullSchema>;
export type ImportPayloadInput = z.infer<typeof importPayloadSchema>;
