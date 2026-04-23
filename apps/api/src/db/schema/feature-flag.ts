import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { user } from "./user";

/**
 * feature_flag
 *
 * All feature flags stored as DB rows so they can be toggled from the admin
 * dashboard without a redeploy or SSH session.
 */
export const featureFlag = sqliteTable("feature_flag", {
    key: text("key").primaryKey(),
    enabled: integer("enabled").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .notNull()
        .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

export type FeatureFlag = typeof featureFlag.$inferSelect;

/**
 * admin_audit_log
 *
 * Paper trail for all mutating admin actions: toggling games/flags, deleting
 * users, flushing cache, etc.
 */
export const adminAuditLog = sqliteTable("admin_audit_log", {
    id: text("id").primaryKey(),
    adminId: text("admin_id")
        .notNull()
        .references(() => user.id),
    action: text("action").notNull(),
    target: text("target"),
    payload: text("payload"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .notNull()
        .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
    admin: one(user, { fields: [adminAuditLog.adminId], references: [user.id] }),
}));
