import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    codeHash: text("code_hash"),
    isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull().default(false),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
});
