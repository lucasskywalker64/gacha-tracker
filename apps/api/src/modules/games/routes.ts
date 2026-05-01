import { Elysia } from "elysia";
import { db } from "../../db/client";
import { game, userGame } from "../../db/schema";
import { eq } from "drizzle-orm";
import { authPlugin } from "../auth";

export const gamesRouter = new Elysia()
    .use(authPlugin)
    .get("/games", async () => {
        return await db.select().from(game).where(eq(game.isActive, 1));
    })
    .get(
        "/user/games",
        async ({ user }) => {
            // Return user's games joined with the game details
            const result = await db
                .select({
                    game: game,
                    userGame: userGame,
                })
                .from(userGame)
                .innerJoin(game, eq(userGame.gameId, game.id))
                .where(eq(userGame.userId, user!.id));

            return result.map(({ game, userGame }) => ({
                ...userGame,
                gameDisplayName: game.displayName,
                gameIconUrl: game.iconUrl,
                gameConfig: game.config,
            }));
        },
        { auth: true }
    );
