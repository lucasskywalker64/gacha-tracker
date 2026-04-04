import { Elysia } from "elysia";
import { db } from "../../db/client";
import { games, userGames } from "../../db/schema";
import { eq } from "drizzle-orm";
import { authPlugin } from "../auth";

export const gamesRouter = new Elysia()
  .use(authPlugin)
  .get("/games", async () => {
    return await db.select().from(games).where(eq(games.isActive, 1));
  })
  .get(
    "/user/games",
    async ({ user }) => {
      // Return user's games joined with the game details
      const result = await db
        .select({
          game: games,
          userGame: userGames,
        })
        .from(userGames)
        .innerJoin(games, eq(userGames.gameId, games.id))
        .where(eq(userGames.userId, user!.id));

      return result.map(({ game, userGame }) => ({
        ...userGame,
        gameDisplayName: game.displayName,
        gameIconUrl: game.iconUrl,
        gameConfig: game.config,
      }));
    },
    { auth: true }
  );
