import { Elysia } from "elysia";
import { db } from "../../db/client";
import { game, userGame } from "../../db/schema";
import { eq } from "drizzle-orm";
import { authPlugin } from "../auth";
import { accountsRouter } from "./accounts";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";

export const gamesRouter = new Elysia()
    .use(authPlugin)
    .use(accountsRouter)
    .get("/games", async () => {
        const cacheKey = RedisKeys.gamesList();
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch {
            // Redis fallback
        }

        const games = await db.select().from(game).where(eq(game.isActive, 1));

        try {
            await redis.set(cacheKey, JSON.stringify(games), "EX", 3600);
        } catch {
            // Redis fallback
        }

        return games;
    })
    .get(
        "/user/games",
        async ({ user }) => {
            // Return user's games joined with the game details
            const result = await db
                .select({
                    userGame: userGame,
                    gameDisplayName: game.displayName,
                    gameIconUrl: game.iconUrl,
                })
                .from(userGame)
                .innerJoin(game, eq(userGame.gameId, game.id))
                .where(eq(userGame.userId, user!.id));

            return result.map(({ userGame, gameDisplayName, gameIconUrl }) => ({
                ...userGame,
                gameDisplayName,
                gameIconUrl,
            }));
        },
        { auth: true }
    );
