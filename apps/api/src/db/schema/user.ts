import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const user = sqliteTable(
    "user",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        email: text("email").notNull().unique(),
        emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
        image: text("image"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        codeHash: text("code_hash"),
        isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull().default(false),
        role: text("role").notNull().default("user"),
        banned: integer("banned", { mode: "boolean" }).notNull().default(false),
        banReason: text("ban_reason"),
        banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
        theme: text("theme").notNull().default("system"),
        pityDisplayMode: text("pity_display_mode").notNull().default("count_up"),
    },
    (table) => [
        check(
            "user_theme_check",
            sql`${table.theme} IN ('system', 'quantum-dark', 'amber-dawn', 'wobbly-waves')`
        ),
        check(
            "user_pity_display_mode_check",
            sql`${table.pityDisplayMode} IN ('count_up', 'count_down')`
        ),
    ]
);

export const session = sqliteTable(
    "session",
    {
        id: text("id").primaryKey(),
        expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
        token: text("token").notNull().unique(),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
    },
    (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = sqliteTable(
    "account",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: integer("access_token_expires_at", {
            mode: "timestamp_ms",
        }),
        refreshTokenExpiresAt: integer("refresh_token_expires_at", {
            mode: "timestamp_ms",
        }),
        scope: text("scope"),
        password: text("password"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [
        index("account_user_id_idx").on(table.userId),
        index("account_provider_account_idx").on(table.providerId, table.accountId),
    ]
);

export const verification = sqliteTable(
    "verification",
    {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const passkey = sqliteTable(
    "passkey",
    {
        id: text("id").primaryKey(),
        name: text("name"),
        publicKey: text("public_key").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        credentialID: text("credential_id").notNull(),
        counter: integer("counter").notNull(),
        deviceType: text("device_type").notNull(),
        backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
        transports: text("transports"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        aaguid: text("aaguid"),
    },
    (table) => [
        index("passkey_user_id_idx").on(table.userId),
        index("passkey_credential_id_idx").on(table.credentialID),
    ]
);

export const userEmails = sqliteTable(
    "user_emails",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        email: text("email").notNull().unique(),
        verified: integer("verified", { mode: "boolean" }).notNull().default(false),
        verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [index("user_emails_user_id_idx").on(table.userId)]
);
