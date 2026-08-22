import { db } from "../../db/client";
import { userGame, type UserGame } from "../../db/schema";
import { eq, and, asc, desc } from "drizzle-orm";

/**
 * Resolves the default game account for a user and game:
 * returns the primary account if set, otherwise the earliest created account.
 */
export async function resolvePrimaryOrEarliestAccount(
    userId: string,
    gameId: string
): Promise<UserGame | undefined> {
    return await db.query.userGame.findFirst({
        where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
        orderBy: [desc(userGame.isPrimary), asc(userGame.createdAt)],
    });
}
