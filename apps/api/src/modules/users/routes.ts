import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { userSettings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { authPlugin } from "../auth";

export const userRouter = new Elysia({ prefix: "/user" })
    .use(authPlugin)
    .guard({ auth: true })

    // GET /user/settings - Retrieve preferences (create defaults if non-existent)
    .get("/settings", async ({ user: sessionUser }) => {
        const userId = sessionUser!.id;
        let settings = await db.query.userSettings.findFirst({
            where: eq(userSettings.userId, userId),
        });

        if (!settings) {
            // Seed default settings on-the-fly
            const newSettings = {
                userId,
                theme: "system",
                pityDisplayMode: "count_up",
            };
            await db.insert(userSettings).values(newSettings);
            settings = {
                ...newSettings,
                updatedAt: new Date(),
            };
        }

        return settings;
    })

    // PATCH /user/settings - Update specific settings
    .patch(
        "/settings",
        async ({ user: sessionUser, body }) => {
            const userId = sessionUser!.id;

            // Ensure settings row exists first
            const existing = await db.query.userSettings.findFirst({
                where: eq(userSettings.userId, userId),
            });

            if (!existing) {
                await db.insert(userSettings).values({
                    userId,
                    theme: body.theme ?? "system",
                    pityDisplayMode: body.pityDisplayMode ?? "count_up",
                });
            } else {
                await db
                    .update(userSettings)
                    .set({
                        ...body,
                        updatedAt: new Date(),
                    })
                    .where(eq(userSettings.userId, userId));
            }

            return { success: true };
        },
        {
            body: t.Object({
                theme: t.Optional(
                    t.Union([
                        t.Literal("system"),
                        t.Literal("quantum-dark"),
                        t.Literal("amber-dawn"),
                        t.Literal("wobbly-waves"),
                    ])
                ),
                pityDisplayMode: t.Optional(
                    t.Union([t.Literal("count_up"), t.Literal("count_down")])
                ),
            }),
        }
    );
