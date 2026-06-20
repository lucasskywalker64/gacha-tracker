import { config } from "../../config";
import type { DiscordProfile, GoogleProfile } from "better-auth";
import { APIError } from "better-auth/api";

export const socialProvidersConfig = {
    discord: {
        clientId: config.DISCORD_CLIENT_ID,
        clientSecret: config.DISCORD_CLIENT_SECRET,
        prompt: "consent" as const,
        mapProfileToUser: async (profile: DiscordProfile) => {
            if (!profile.email || !profile.verified) {
                throw new APIError("BAD_REQUEST", {
                    message:
                        "Your Discord account does not have a verified email address. Please verify your email on Discord first.",
                });
            }

            const email = profile.email || "";
            const name = profile.username || "Discord User";
            let image = null;

            if (profile.id && profile.avatar) {
                image = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`;
            }

            return {
                email,
                name,
                image,
                emailVerified: true,
            };
        },
    },
    google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        prompt: "select_account" as const,
        mapProfileToUser: async (profile: GoogleProfile) => {
            let email = profile.email || "";
            const name = profile.name || "Google User";
            const image = profile.picture || null;

            if (!email) {
                email = `${crypto.randomUUID()}@anon.gacha-tracker.app`;
            }

            return {
                email,
                name,
                image,
                emailVerified: true,
            };
        },
    },
};
